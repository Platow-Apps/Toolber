// Supabase Edge Function: notify
// Triggered by the `on_notification_created` DB trigger on every `notifications` insert.
// Checks the recipient's notification_preferences, and if the relevant category is
// enabled, sends an email via Resend. In-app delivery is handled separately by the
// client subscribing to the `notifications` table via Supabase Realtime — this
// function only ever handles the email side.
//
// Deploy: supabase functions deploy notify
// Secrets needed (set via `supabase secrets set`):
//   RESEND_API_KEY       — server-side only, never exposed to the client
//   SUPABASE_URL          — auto-provided by the Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by the Supabase runtime
//   NOTIFY_SHARED_SECRET  — must match the Vault secret of the same name;
//                           without it this function refuses every request
//                           (see 0030_notify_vault_and_idempotency.sql)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Maps a notification's `type` to the notification_preferences column that gates it.
// Tool-activity types are in-app + email together (this function only sends the email
// half); Toolber-updates types (functional/community/marketing) are email-only and
// aren't fired through this per-event trigger path at all — those are sent as batch
// campaigns, not from individual `notifications` rows.
const TYPE_TO_PREFERENCE: Record<string, string> = {
  borrow_requested: 'borrower_reminders',
  borrow_approved: 'borrower_reminders',
  borrow_denied: 'borrower_reminders',
  borrow_completed: 'borrower_reminders',
  tool_malfunctioning: 'tool_malfunctioning',
  tool_availability: 'tool_availability',
  tool_status_change: 'tool_status_change',
  meeting_reminder: 'meeting_reminders',
  // Group decisions are not borrow reminders: mapping them together meant
  // switching off borrow reminders silently stopped group approvals too (SEC-5).
  group_join_requested: 'group_activity',
  group_join_approved: 'group_activity',
  group_join_denied: 'group_activity',
  borrow_overdue: 'borrower_reminders',
  borrow_overdue_lender: 'borrower_reminders',
  borrow_tool_removed: 'borrower_reminders',
  borrow_cancelled: 'borrower_reminders',
}

// In-app chat messages are frequent enough that emailing every single one
// would defeat the actual point of moving coordination into the app instead
// of back out to people's inboxes. Unmapped types are now refused outright
// (SEC-5), but this stays an explicit skip: new_message *is* mapped, it just
// deliberately never goes out by email.
const IN_APP_ONLY = new Set(['new_message'])

// SEC-4: a shared secret the database trigger sends, proving a call came from
// this project's Postgres rather than from anyone who knows the URL and holds
// the publishable key -- which is public by design, so JWT verification alone
// authenticates almost nobody. Stored in Vault on the database side
// (0030_notify_vault_and_idempotency.sql) and as a function secret here.
const SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')

/**
 * Length-independent constant-time compare. Not strictly required for a
 * header check like this, but timing-safe comparison is cheap and means the
 * secret can't be recovered a byte at a time.
 */
function secretMatches(provided: string | null): boolean {
  if (!SHARED_SECRET || !provided) return false
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(SHARED_SECRET)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

Deno.serve(async (req) => {
  try {
    // Fail closed, like the unmapped-type check below: if the secret isn't
    // configured, nothing is authenticated, so nothing should be sent.
    if (!SHARED_SECRET) {
      console.error('NOTIFY_SHARED_SECRET is not set — refusing every request. See 0030.')
      return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 })
    }
    if (!secretMatches(req.headers.get('x-toolber-signature'))) {
      return new Response(JSON.stringify({ error: 'bad signature' }), { status: 401 })
    }

    const { notification_id } = await req.json()

    const { data: notification, error: notifErr } = await supabase
      .from('notifications')
      .select('id, profile_id, type, payload')
      .eq('id', notification_id)
      .single()

    if (notifErr || !notification) {
      return new Response(JSON.stringify({ error: 'notification not found' }), { status: 404 })
    }

    if (IN_APP_ONLY.has(notification.type)) {
      return new Response(JSON.stringify({ skipped: 'in-app only' }), { status: 200 })
    }

    // SEC-4 (idempotency): claim this notification before sending. The unique
    // primary key means a duplicate trigger fire, or an http retry, loses the
    // race and skips rather than sending a second email. Claiming *before*
    // the send is deliberate -- a delivery that fails after this point is a
    // missed email, which is better than a duplicate one.
    const { error: claimErr } = await supabase
      .from('notification_deliveries')
      .insert({ notification_id: notification.id })
    if (claimErr) {
      if (claimErr.code === '23505') {
        return new Response(JSON.stringify({ skipped: 'already delivered' }), { status: 200 })
      }
      // Anything else means we can't guarantee single delivery; don't send.
      console.error('could not claim notification for delivery:', claimErr)
      return new Response(JSON.stringify({ error: 'claim failed' }), { status: 500 })
    }

    // SEC-5: fail closed. This used to warn and send anyway, which meant any
    // notification type added in a migration but not mapped here would email
    // people regardless of what they had switched off. Refusing to send is
    // recoverable (add the mapping); emailing someone who opted out is not.
    const prefColumn = TYPE_TO_PREFERENCE[notification.type]
    if (!prefColumn) {
      console.error(`Unmapped notification type "${notification.type}" — not sending. Add it to TYPE_TO_PREFERENCE.`)
      return new Response(JSON.stringify({ skipped: 'unmapped type' }), { status: 200 })
    }

    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('profile_id', notification.profile_id)
      .single()

    if (prefs && prefs[prefColumn] === false) {
      return new Response(JSON.stringify({ skipped: 'preference disabled' }), { status: 200 })
    }

    // profiles doesn't store email directly — auth.users does. Service role can read it.
    const { data: authUser } = await supabase.auth.admin.getUserById(notification.profile_id)
    const email = authUser?.user?.email
    if (!email) {
      return new Response(JSON.stringify({ error: 'no email on file' }), { status: 200 })
    }

    const { subject, html } = renderEmail(notification.type, notification.payload)

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Toolber <team@mail.toolber.org>',
        to: email,
        subject,
        html,
      }),
    })

    if (!resendResp.ok) {
      const body = await resendResp.text()
      console.error('Resend send failed', resendResp.status, body)
      return new Response(JSON.stringify({ error: 'email send failed' }), { status: 502 })
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})

// Placeholder copy per type — replace with real templates as the frontend's copy solidifies.
function renderEmail(type: string, payload: Record<string, unknown> | null) {
  const templates: Record<string, { subject: string; body: string }> = {
    borrow_requested: { subject: 'New borrow request on Toolber', body: 'Someone wants to borrow one of your tools.' },
    borrow_approved: { subject: 'Your borrow request was approved', body: 'You can now see the pickup location in the app.' },
    borrow_denied: { subject: 'Your borrow request was declined', body: 'The owner declined this request.' },
    borrow_completed: { subject: 'Borrow marked returned', body: 'A tool borrow was marked as returned.' },
    tool_malfunctioning: { subject: 'A tool was reported malfunctioning', body: 'One of your tools was flagged as malfunctioning and is now unavailable.' },
    group_join_requested: { subject: 'New group join request', body: 'Someone requested to join a group you administer.' },
    group_join_approved: { subject: "You're in!", body: 'Your group join request was approved.' },
    group_join_denied: { subject: 'Group join request update', body: 'Your group join request was declined.' },
    borrow_overdue: { subject: 'A borrowed tool is overdue', body: 'A tool you borrowed is past its return date. Please arrange to get it back to its owner.' },
    borrow_overdue_lender: { subject: 'A tool you lent out is overdue', body: 'A tool you lent out is past its agreed return date.' },
    borrow_cancelled: { subject: 'A borrow request was withdrawn', body: 'Someone withdrew their request to borrow one of your tools.' },
    borrow_tool_removed: { subject: 'A tool you asked about was removed', body: 'A tool you requested to borrow is no longer available for lending.' },
  }
  const t = templates[type] ?? { subject: 'Toolber notification', body: 'You have a new notification.' }

  // borrow_denied's reason is free text the lender typed -- escape before
  // it goes into an HTML email body.
  const reason = type === 'borrow_denied' ? (payload?.reason as string | null) : null
  const reasonHtml = reason
    ? `<p><b>Reason given:</b> ${escapeHtml(reason)}</p>`
    : ''

  return {
    subject: t.subject,
    html: `<p>${t.body}</p>${reasonHtml}<p style="color:#888;font-size:12px">Manage your notification preferences in Settings on Toolber.</p>`,
  }
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

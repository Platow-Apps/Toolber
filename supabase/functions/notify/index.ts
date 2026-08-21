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
  tool_malfunctioning: 'tool_malfunctioning',
  tool_availability: 'tool_availability',
  tool_status_change: 'tool_status_change',
  meeting_reminder: 'meeting_reminders',
  group_join_requested: 'borrower_reminders',
  group_join_approved: 'borrower_reminders',
  group_join_denied: 'borrower_reminders',
}

// In-app chat messages are frequent enough that emailing every single one
// would defeat the actual point of moving coordination into the app instead
// of back out to people's inboxes. An unmapped type defaults to *sending*
// (see below), so this needs its own explicit skip rather than just being
// left out of TYPE_TO_PREFERENCE.
const IN_APP_ONLY = new Set(['new_message'])

Deno.serve(async (req) => {
  try {
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

    const prefColumn = TYPE_TO_PREFERENCE[notification.type]
    if (!prefColumn) {
      console.warn(`Unmapped notification type "${notification.type}" — sending by default`)
    }

    if (prefColumn) {
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select(prefColumn)
        .eq('profile_id', notification.profile_id)
        .single()

      if (prefs && prefs[prefColumn] === false) {
        return new Response(JSON.stringify({ skipped: 'preference disabled' }), { status: 200 })
      }
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
    tool_malfunctioning: { subject: 'A tool was reported malfunctioning', body: 'One of your tools was flagged as malfunctioning and is now unavailable.' },
    group_join_requested: { subject: 'New group join request', body: 'Someone requested to join a group you administer.' },
    group_join_approved: { subject: "You're in!", body: 'Your group join request was approved.' },
    group_join_denied: { subject: 'Group join request update', body: 'Your group join request was declined.' },
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

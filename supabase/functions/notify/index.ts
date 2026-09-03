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
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT — web push. Leave
//                           unset to run with push switched off.
//   NOTIFY_SHARED_SECRET  — must match the Vault secret notify_shared_secret;
//                           without it this function refuses every request
//                           (see 0030_notify_vault_and_idempotency.sql)
//   NOTIFY_SHARED_SECRET_PREVIOUS — optional, and only during a rotation
//
// ROTATING THE SHARED SECRET, WITHOUT LOSING ANYTHING
//
// The secret lives in two places that cannot change in the same instant --
// Vault, which the database trigger reads, and this function's environment.
// Change either one alone and every notification in between is refused with a
// 401. pg_net does not retry, so those emails and pushes are gone.
//
//   1. Set NOTIFY_SHARED_SECRET_PREVIOUS to the CURRENT secret. Redeploy.
//      Both values are now accepted, so nothing can be dropped.
//   2. Set NOTIFY_SHARED_SECRET to the new value. Redeploy.
//   3. Update Vault:
//        select vault.update_secret(
//          (select id from vault.secrets where name = 'notify_shared_secret'),
//          '<new value>');
//   4. Clear NOTIFY_SHARED_SECRET_PREVIOUS. Redeploy.
//
// Step 4 is not optional: until it is done, the retired secret still opens the
// door. Every use of the fallback logs a warning naming this, so a rotation
// left half-finished is visible rather than permanent.

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
  pickup_requested: 'borrower_reminders',
  pickup_ready: 'borrower_reminders',
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
const SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')?.trim()

// Accepted alongside the current one, so a rotation has no gap.
//
// The secret lives in two places that cannot be changed in the same instant:
// Vault, which the database trigger reads, and this function's own
// environment. Whichever is changed first, every notification fired before the
// second catches up is refused with a 401 -- and pg_net does not retry, so
// those emails and pushes are simply lost.
//
// With this set, the order stops mattering: put the OLD value here, set the
// new one in both places at whatever pace suits, then clear this. Nothing is
// dropped in between.
//
// Leave it unset in normal operation. Every use is logged, so a rotation left
// half-finished is visible rather than permanent.
const PREVIOUS_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET_PREVIOUS')?.trim()
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')?.trim()
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')?.trim()

// A VAPID keypair is P-256. The public key is an uncompressed point -- 65
// bytes, 87 base64url characters -- and the private key is a 32-byte scalar,
// 43 characters. Checking the lengths here turns the two mistakes people
// actually make (a truncated paste, or the halves swapped) into a message
// that says which one it was, instead of web-push's "should be 65 bytes long
// when decoded" thrown from four frames deep.
const VAPID_PUBLIC_KEY_LENGTH = 87
const VAPID_PRIVATE_KEY_LENGTH = 43
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@toolber.org'

// Where email links point. Overridable so a staging deploy doesn't send
// people to production.
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'https://toolber.org'

/**
 * Length-independent constant-time compare. Not strictly required for a
 * header check like this, but timing-safe comparison is cheap and means the
 * secret can't be recovered a byte at a time.
 */
function constantTimeEquals(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(expected)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * True when the header carries either the current secret or, during a
 * rotation, the previous one.
 *
 * Both are compared in constant time. Not strictly required for a header
 * check, but it is cheap and means the secret cannot be recovered a byte at a
 * time.
 */
function secretMatches(provided: string | null): boolean {
  if (!provided) return false
  if (SHARED_SECRET && constantTimeEquals(provided, SHARED_SECRET)) return true

  if (PREVIOUS_SHARED_SECRET && constantTimeEquals(provided, PREVIOUS_SHARED_SECRET)) {
    // Deliberately noisy. The fallback exists for the minutes of a rotation,
    // and an unnoticed one left in place means a secret you meant to retire is
    // still accepted indefinitely.
    console.warn(
      'notify: accepted the PREVIOUS shared secret — a rotation is still in progress. ' +
        'Once Vault carries the new value, clear NOTIFY_SHARED_SECRET_PREVIOUS and redeploy.'
    )
    return true
  }

  return false
}

// Copy for push notifications. Kept in step with src/lib/notifications.js and
// public/push-sw.js -- the service worker has its own table as a fallback for
// a payload that arrives without a body.
const PUSH_COPY: Record<string, string> = {
  borrow_requested: 'Someone wants to borrow one of your tools.',
  borrow_approved: "Your borrow request was approved — request pickup when you're ready.",
  borrow_denied: 'Your borrow request was declined.',
  pickup_requested: 'A borrower is ready to collect — share where to meet.',
  pickup_ready: 'The pickup location is ready.',
  borrow_completed: 'A borrow was marked returned.',
  borrow_cancelled: 'Someone withdrew a request to borrow one of your tools.',
  borrow_tool_removed: 'A tool you asked to borrow is no longer available.',
  borrow_overdue: 'A tool you borrowed is past its return date.',
  borrow_overdue_lender: 'A tool you lent out is past its return date.',
  tool_malfunctioning: 'One of your tools was reported malfunctioning.',
  group_join_requested: 'Someone asked to join a group you administer.',
  group_join_approved: "You're in! Your group join request was approved.",
  group_join_denied: 'Your group join request was declined.',
  new_message: 'You have a new message.',
}

/** Where tapping the notification lands. Mirrors src/lib/notifications.js. */
function pushDestination(type: string, payload: Record<string, unknown> | null): string {
  const toolId = typeof payload?.tool_id === 'string' ? payload.tool_id : null
  const groupId = typeof payload?.group_id === 'string' ? payload.group_id : null
  const conversationId = typeof payload?.conversation_id === 'string' ? payload.conversation_id : null

  if (type === 'new_message' && conversationId) return `/messages/${conversationId}`
  if (groupId) return `/groups/${groupId}`
  if (toolId) return `/tool/${toolId}`
  return '/'
}

/**
 * Send this notification to every live browser subscription the recipient has.
 *
 * WHY THIS IS INLINE RATHER THAN ITS OWN FUNCTION
 *
 * It started as a separate `push` Edge Function that this one called over
 * HTTP, on the reasoning that a push failure then could not possibly affect
 * the email. That protection was real but the cost was worse: the hop added a
 * second network call and a second auth boundary, and when it failed it did so
 * invisibly -- the calling function logged nothing useful and the called
 * function was never invoked, so there was nothing to read in either place.
 * That is exactly how it did fail in practice.
 *
 * Inline, every outcome lands in this function's own log next to the email it
 * accompanies. The email path stays protected by the same means as before:
 * everything below is inside one try/catch and the result is ignored. The
 * import is dynamic so that even a module-resolution failure is caught here
 * rather than taking the whole function -- and the email with it -- down at
 * boot.
 */
async function sendPush(notification: { profile_id: string; type: string; payload: unknown }) {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.log('push: no VAPID keys configured, skipping')
      return
    }
    if (
      VAPID_PUBLIC_KEY.length !== VAPID_PUBLIC_KEY_LENGTH ||
      VAPID_PRIVATE_KEY.length !== VAPID_PRIVATE_KEY_LENGTH
    ) {
      console.error(
        `push: VAPID keys are the wrong length — public is ${VAPID_PUBLIC_KEY.length} ` +
          `(expected ${VAPID_PUBLIC_KEY_LENGTH}), private is ${VAPID_PRIVATE_KEY.length} ` +
          `(expected ${VAPID_PRIVATE_KEY_LENGTH}). Truncated paste, or the two swapped?`
      )
      return
    }

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', notification.profile_id)
      .is('expired_at', null)

    if (subsErr) {
      console.error('push: could not load subscriptions', subsErr)
      return
    }
    if (!subs || subs.length === 0) {
      console.log('push: no registered devices for', notification.profile_id)
      return
    }

    // Dynamic on purpose -- see the note above. A failure to resolve this
    // must not stop the email.
    const { default: webpush } = await import('npm:web-push@3.6.7')
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    const body = JSON.stringify({
      title: 'Toolber',
      body: PUSH_COPY[notification.type] ?? 'You have a new notification.',
      type: notification.type,
      tag: notification.type,
      url: `${APP_ORIGIN}${pushDestination(notification.type, (notification.payload ?? null) as Record<string, unknown> | null)}`,
    })

    let sent = 0
    const expired: string[] = []

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        // 404/410 is the push service saying this subscription is gone for
        // good -- the browser was uninstalled, or cleared its site data. Mark
        // it rather than retrying it on every future notification.
        if (status === 404 || status === 410) {
          expired.push(sub.id)
        } else {
          console.error('push: send failed', status, err)
        }
      }
    }

    if (expired.length > 0) {
      await supabase
        .from('push_subscriptions')
        .update({ expired_at: new Date().toISOString() })
        .in('id', expired)
    }

    console.log(`push: sent ${sent}/${subs.length}, ${expired.length} expired`)
  } catch (err) {
    console.error('push: failed, email is unaffected', err)
  }
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

    // SEC-5: fail closed. This used to warn and send anyway, which meant any
    // notification type added in a migration but not mapped here would email
    // people regardless of what they had switched off. Refusing to send is
    // recoverable (add the mapping); emailing someone who opted out is not.
    const prefColumn = TYPE_TO_PREFERENCE[notification.type]
    if (!prefColumn) {
      console.error(`Unmapped notification type "${notification.type}" — not sending. Add it to TYPE_TO_PREFERENCE.`)
      return new Response(JSON.stringify({ skipped: 'unmapped type' }), { status: 200 })
    }

    // Two independent gates (0044). The category says whether this *event* is
    // wanted at all; the channel switches say how. Reading both in one round
    // trip because the category check can no longer end the request on its own
    // -- it now decides whether either channel runs.
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(`${prefColumn}, email_enabled, push_enabled`)
      .eq('profile_id', notification.profile_id)
      .single()

    if (prefs && prefs[prefColumn] === false) {
      return new Response(JSON.stringify({ skipped: 'preference disabled' }), { status: 200 })
    }

    // Absent preferences mean a row that has not been created yet, not a
    // refusal -- the same fail-open the category check above uses.
    const emailWanted = prefs?.email_enabled !== false
    const pushWanted = prefs?.push_enabled !== false

    if (!emailWanted && !pushWanted) {
      // Nothing to deliver. Returning before the idempotency claim leaves the
      // row unclaimed, which is right: no channel was attempted, so a later
      // retry has nothing to duplicate.
      return new Response(JSON.stringify({ skipped: 'all channels off' }), { status: 200 })
    }

    // SEC-4 (idempotency): claim this notification before sending anything.
    // The unique primary key means a duplicate trigger fire, or an http retry,
    // loses the race and skips rather than delivering twice. Claiming *before*
    // the send is deliberate -- a delivery that fails after this point is a
    // missed message, which is better than a duplicate one.
    //
    // The claim moved above the in-app-only check when push was added: it now
    // means "this notification has been handled", covering both channels,
    // rather than "an email went out".
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

    // Push goes to every type the preference allows, including the ones that
    // deliberately never email. new_message is the clearest case: a chat
    // message should not generate an email, but a buzz is exactly right.
    if (pushWanted) await sendPush(notification)

    if (IN_APP_ONLY.has(notification.type)) {
      return new Response(JSON.stringify({ skipped: 'in-app only', pushed: pushWanted }), { status: 200 })
    }

    if (!emailWanted) {
      return new Response(JSON.stringify({ skipped: 'email off', pushed: pushWanted }), { status: 200 })
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
    borrow_approved: { subject: 'Your borrow request was approved', body: 'Open the tool in Toolber and request pickup when you are ready to collect. The owner shares where to meet at that point, not before.' },
    pickup_requested: { subject: 'A borrower is ready to collect', body: 'Someone you approved has asked to pick up your tool. Open it in Toolber to share where to meet &mdash; either your saved address, or a one-off spot for this borrower.' },
    pickup_ready: { subject: 'Your pickup location is ready', body: 'The owner has shared where to collect the tool. Open it in Toolber to see the details.' },
    borrow_denied: { subject: 'Your borrow request was declined', body: 'The owner declined this request.' },
    borrow_completed: { subject: 'Borrow marked returned', body: 'A tool borrow was marked as returned.' },
    tool_malfunctioning: { subject: 'A tool was reported malfunctioning', body: 'One of your tools was flagged as malfunctioning and is now unavailable.' },
    group_join_requested: { subject: 'New group join request', body: 'Someone requested to join a group you administer.' },
    group_join_approved: { subject: "You're in!", body: 'Your group join request was approved.' },
    group_join_denied: { subject: 'Group join request update', body: 'Your group join request was declined.' },
    borrow_overdue: { subject: 'A borrowed tool is overdue', body: 'A tool you borrowed is past its return date. Please arrange to get it back to its owner.' },
    borrow_overdue_lender: { subject: 'A tool you lent out is overdue', body: 'A tool you lent out is past its agreed return date. If you can&rsquo;t reach the borrower, you can report them from the request in Toolber &mdash; and if you believe the tool has been stolen, that is a matter for local law enforcement.' },
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

  // A link straight to the thing the email is about. Without it, a lender
  // reading "someone wants to borrow one of your tools" had to open the app
  // and work out which one — the hunt-and-guess this removes.
  const toolId = typeof payload?.tool_id === 'string' ? payload.tool_id : null
  const groupId = typeof payload?.group_id === 'string' ? payload.group_id : null
  const path = toolId ? `/tool/${toolId}` : groupId ? `/groups/${groupId}` : ''
  const CTA_LABEL: Record<string, string> = {
    borrow_requested: 'Review this request',
    borrow_approved: 'Request pickup',
    pickup_requested: 'Share the pickup spot',
    pickup_ready: 'See where to collect',
  }
  const ctaLabel = CTA_LABEL[type] ?? 'Open in Toolber'
  const ctaHtml = path
    ? `<p style="margin:18px 0"><a href="${APP_ORIGIN}${path}" style="background:#16181B;color:#F2B90B;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;font-weight:600">${ctaLabel}</a></p>`
    : ''

  return {
    subject: t.subject,
    html: `<p>${t.body}</p>${reasonHtml}${ctaHtml}<p style="color:#888;font-size:12px">Manage your notification preferences in Settings on Toolber.</p>`,
  }
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// Supabase Edge Function: push
//
// Sends one notification to every live browser subscription belonging to the
// recipient. Called by the `notify` function rather than by the database
// trigger directly, so that a push failure can never take the email path down
// with it -- notify wraps the call and ignores the result.
//
// Deploy: supabase functions deploy push
// Secrets needed (supabase secrets set / dashboard):
//   VAPID_PUBLIC_KEY   — same value the client ships as VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY  — server-side only, never in the client bundle
//   VAPID_SUBJECT      — a mailto: or https: URL identifying the sender,
//                        e.g. mailto:support@toolber.org
//   NOTIFY_SHARED_SECRET — the same secret notify checks; this function is
//                        called with it in x-toolber-signature
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Generate the VAPID pair once with:  npx web-push generate-vapid-keys

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@toolber.org'
const SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'https://toolber.org'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

// Deliberately kept in step with src/lib/notifications.js and
// public/push-sw.js. The service worker has its own copy as a fallback; this
// one wins, because a payload built here can use the notification's own data.
const COPY: Record<string, string> = {
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

/** Where tapping the notification should land. Mirrors notifications.js. */
function destinationFor(type: string, payload: Record<string, unknown> | null): string {
  const toolId = typeof payload?.tool_id === 'string' ? payload.tool_id : null
  const groupId = typeof payload?.group_id === 'string' ? payload.group_id : null
  const conversationId = typeof payload?.conversation_id === 'string' ? payload.conversation_id : null

  if (type === 'new_message' && conversationId) return `/messages/${conversationId}`
  if (groupId) return `/groups/${groupId}`
  if (toolId) return `/tool/${toolId}`
  return '/'
}

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
    if (!SHARED_SECRET) {
      console.error('NOTIFY_SHARED_SECRET is not set — refusing every request.')
      return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 })
    }
    if (!secretMatches(req.headers.get('x-toolber-signature'))) {
      return new Response(JSON.stringify({ error: 'bad signature' }), { status: 401 })
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      // Not an error: a deployment without VAPID keys simply has push off.
      // Saying so plainly beats a stack trace in the logs on every send.
      return new Response(JSON.stringify({ skipped: 'no vapid keys' }), { status: 200 })
    }

    const { profile_id, type, payload } = await req.json()
    if (!profile_id || !type) {
      return new Response(JSON.stringify({ error: 'profile_id and type required' }), { status: 400 })
    }

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', profile_id)
      .is('expired_at', null)

    if (subsErr) {
      console.error('could not load push subscriptions', subsErr)
      return new Response(JSON.stringify({ error: 'lookup failed' }), { status: 500 })
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no devices' }), { status: 200 })
    }

    const body = JSON.stringify({
      title: 'Toolber',
      body: COPY[type] ?? 'You have a new notification.',
      type,
      tag: type,
      url: `${APP_ORIGIN}${destinationFor(type, payload ?? null)}`,
    })

    let sent = 0
    const expired: string[] = []

    // Sequential rather than Promise.all: a person has one or two devices, and
    // serialising keeps one slow push service from being masked by another.
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
        // good — the browser was uninstalled, or cleared its site data. Mark
        // it rather than retrying it forever on every notification.
        if (status === 404 || status === 410) {
          expired.push(sub.id)
        } else {
          console.error('push send failed', status, err)
        }
      }
    }

    if (expired.length > 0) {
      await supabase
        .from('push_subscriptions')
        .update({ expired_at: new Date().toISOString() })
        .in('id', expired)
    }

    return new Response(JSON.stringify({ sent, expired: expired.length }), { status: 200 })
  } catch (err) {
    console.error('push function failed', err)
    return new Response(JSON.stringify({ error: 'unexpected error' }), { status: 500 })
  }
})

// Supabase Edge Function: release-account-email
//
// Frees a deleted account's email address so the person can sign up again
// later, which is a normal thing for a neighbor to want.
//
// WHY THIS EXISTS SEPARATELY FROM delete_my_account()
//
// Deleting an account (0032_account_deletion.sql) scrubs the profile from
// SQL, but it cannot touch auth.users: the row can only be changed through
// the admin API, and it cannot simply be deleted either, because profiles
// cascades from it into seven foreign keys that deliberately preserve the
// counterparty's borrow history and messages.
//
// So instead of deleting the sign-in record, this rewrites its email to an
// undeliverable placeholder on the .invalid TLD (reserved by RFC 2606). The
// original address is then free to register a genuinely new account, and the
// old record can no longer be signed into with it.
//
// Deploy: supabase functions deploy release-account-email
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, both auto-provided.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

/** A password nobody holds, so the scrubbed record can't be signed into. */
function unguessablePassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  try {
    // The caller proves who they are with their own session token. This is
    // not the trigger-signed path the notify function uses -- a real signed-in
    // person is making this request about their own account.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 })
    }

    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 })
    }

    // Only ever after the account has actually been deleted. Without this
    // check, a valid session could be used to lock its own live account out.
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('deleted_at')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: 'profile not found' }), { status: 404 })
    }
    if (!profile.deleted_at) {
      return new Response(JSON.stringify({ error: 'account is not deleted' }), { status: 409 })
    }

    // Already released by an earlier attempt -- report success so a retry
    // after a dropped connection isn't treated as a failure.
    if (user.email?.endsWith('.invalid')) {
      return new Response(JSON.stringify({ released: true, already: true }), { status: 200 })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
      email: `deleted-${user.id}@deleted.toolber.invalid`,
      // Mark confirmed so Supabase doesn't try to send a verification mail to
      // an address that cannot receive one.
      email_confirm: true,
      password: unguessablePassword(),
    })

    if (updateErr) {
      console.error('could not release email for', user.id, updateErr)
      return new Response(JSON.stringify({ error: 'could not release address' }), { status: 500 })
    }

    return new Response(JSON.stringify({ released: true }), { status: 200 })
  } catch (err) {
    console.error('release-account-email failed', err)
    return new Response(JSON.stringify({ error: 'unexpected error' }), { status: 500 })
  }
})

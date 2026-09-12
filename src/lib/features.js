/**
 * Switches for things that are built but not currently offered.
 *
 * A flag here means the code is finished and deliberately not shown — not
 * that it is half-done. Deleting the feature instead would lose the component,
 * its tests, and the reasoning in its comments, and whoever turned it back on
 * would rebuild all three from memory.
 */

/**
 * "Continue with Google" on Log in and Sign up.
 *
 * Off because the Google Cloud OAuth client has not been configured, and a
 * button that returns "Unsupported provider" is worse than no button: it reads
 * as the app being broken rather than as a sign-in method that does not exist
 * yet.
 *
 * To turn it back on: create the OAuth client (authorized redirect URI is
 * Supabase's `/auth/v1/callback`, not toolber.org), paste the ID and secret
 * into Supabase → Authentication → Providers → Google, add the site origin to
 * Authentication → URL Configuration → Redirect URLs, then flip this to true.
 * `docs/legal-checklist.md` E2 has the privacy questions that go with it.
 *
 * Nothing else needs changing — `GoogleSignIn` and its tests are untouched,
 * and both screens already read this flag.
 */
export const GOOGLE_SIGN_IN_ENABLED = false;

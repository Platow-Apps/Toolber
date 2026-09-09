import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * "Continue with Google" — one button serving both Log in and Sign up.
 *
 * Deliberately one component and one label for both screens, because with
 * OAuth they are the same action. Google tells us who someone is; whether a
 * Toolber account already exists for that address is our lookup, not their
 * decision. Two buttons saying different things would imply a choice the
 * person does not actually have.
 *
 * WHAT HAPPENS AFTERWARDS, AND WHY NOTHING SPECIAL IS NEEDED
 *
 * Supabase creates the auth user, the existing trigger creates the profile
 * row with profile_complete false, and RequireAuth sends anyone in that state
 * to /onboarding. So a Google arrival lands on the same screen an email
 * signup does, and accepts the terms, confirms an address and picks a display
 * name there exactly as before. The terms are therefore still accepted before
 * anything can be listed or borrowed — which matters, because this button
 * skips the signup form where an email user first sees them.
 *
 * No Turnstile here. It guards a form that can be submitted a thousand times
 * a minute; this hands off to Google, who are considerably better at the same
 * question.
 */
export default function GoogleSignIn({ className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true);
    setError("");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Back to where they started rather than to Supabase's configured Site
      // URL, so a link opened on a preview deploy returns to that deploy.
      options: { redirectTo: `${window.location.origin}/` },
    });
    // On success the browser leaves for Google and this component is gone, so
    // there is nothing to reset — only a failure gets this far.
    if (oauthError) {
      setBusy(false);
      setError(oauthError.message);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-cardBorder bg-white py-3 font-condensed text-sm font-bold uppercase tracking-wide text-asphalt disabled:opacity-50"
      >
        {/* Google's mark, drawn inline like every other icon here. Its four
            brand colours are fixed by Google's own terms of use, so these are
            the one place raw hex is correct rather than a theme colour. */}
        <svg aria-hidden="true" viewBox="0 0 18 18" className="h-4 w-4">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>

      {error && <p className="mt-2 text-sm text-signal">{error}</p>}
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import BrandBar from "../components/BrandBar";
import SearchTagline from "../components/SearchTagline";
import Turnstile from "../components/Turnstile";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  // Dormant until VITE_TURNSTILE_SITE_KEY is set (see .env.example) --
  // Turnstile itself renders nothing without it, so this only starts
  // gating submission once the Cloudflare + Supabase dashboard setup is done.
  const captchaRequired = Boolean(import.meta.env?.VITE_TURNSTILE_SITE_KEY);
  const canSubmit = ageConfirmed && (!captchaRequired || captchaToken);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin, captchaToken: captchaToken ?? undefined },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is off, Supabase returns a session immediately.
    if (data.session) {
      // Only loggable here: with confirmation on there is no session yet, so
      // the events insert would fail its own RLS check.
      await logEvent(data.session.user?.id, EVENTS.ACCOUNT_CREATED);
      navigate("/onboarding", { replace: true });
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-app flex-col items-center justify-center bg-page px-6 text-center">
        <h1 className="mb-2 font-condensed text-2xl font-bold uppercase text-asphalt">Check your email</h1>
        <p className="max-w-sm text-sm text-ink">
          We sent a confirmation link to <b>{email}</b>. Click it, then come back and log in.
        </p>
        <Link to="/login" className="mt-5 font-semibold text-racing">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-app bg-page">
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar>
          <SearchTagline />
        </BrandBar>
      </div>
      <div className="flex justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-sm font-semibold text-ink">Create your account</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="signup-email" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Email</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>I confirm I am 18 years of age or older.</span>
          </label>

          <Turnstile onToken={setCaptchaToken} />

          {error && <p className="text-sm text-signal">{error}</p>}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-racing">
            Log in
          </Link>
        </p>
      </div>
      </div>
    </div>
  );
}

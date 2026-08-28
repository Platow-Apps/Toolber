import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";
import SearchTagline from "../components/SearchTagline";
import Turnstile from "../components/Turnstile";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState(null);
  // Bumped after a failed attempt so Turnstile issues a fresh token. The
  // spent one comes back as "timeout-or-duplicate" — a token is single-use,
  // and the widget keeps showing its Success tick regardless.
  const [captchaReset, setCaptchaReset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Supabase's Bot and Abuse Protection setting applies to every gotrue auth
  // call once enabled in the dashboard, not just signUp -- signInWithPassword
  // started rejecting every login with "no captcha_token found" the moment
  // it was turned on, since only Signup had a Turnstile widget wired up.
  const captchaRequired = Boolean(import.meta.env?.VITE_TURNSTILE_SITE_KEY);
  const canSubmit = !captchaRequired || captchaToken;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaToken ?? undefined },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      setCaptchaReset((n) => n + 1);
      return;
    }
    navigate(location.state?.from?.pathname ?? "/", { replace: true });
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
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="login-email" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>

          <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />

          {error && <p className="text-sm text-signal">{error}</p>}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Log In"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink">
          New to Toolber?{" "}
          <Link to="/signup" className="font-semibold text-racing">
            Create an account
          </Link>
        </p>
      </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthHero from "../components/AuthHero";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is off, Supabase returns a session immediately.
    if (data.session) {
      navigate("/onboarding", { replace: true });
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-page px-6 text-center">
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
    <div className="min-h-screen bg-page">
      <AuthHero />
      <div className="flex justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-sm font-semibold text-ink">Create your account</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>

          {error && <p className="text-sm text-signal">{error}</p>}

          <button
            type="submit"
            disabled={loading}
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

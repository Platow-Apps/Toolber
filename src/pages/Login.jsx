import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";
import SearchTagline from "../components/SearchTagline";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
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

          {error && <p className="text-sm text-signal">{error}</p>}

          <button
            type="submit"
            disabled={loading}
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

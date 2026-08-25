import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("load failed"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Cloudflare Turnstile — basic bot/abuse protection on signup. Renders
// nothing (and never calls onToken) unless VITE_TURNSTILE_SITE_KEY is set,
// so signup keeps working exactly as before until the account-side setup is
// done: create a Turnstile widget at dash.cloudflare.com (get a site key and
// a secret key), set VITE_TURNSTILE_SITE_KEY here + in the Cloudflare build
// env vars, and paste the secret key into the Supabase dashboard under
// Authentication → Settings → Bot and Abuse Protection → enable Turnstile.
export default function Turnstile({ onToken }) {
  const siteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY;
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => setError("Verification failed to load — refresh and try again."),
        });
      })
      .catch(() => setError("Verification failed to load — refresh and try again."));

    return () => {
      cancelled = true;
      if (widgetIdRef.current != null) window.turnstile?.remove(widgetIdRef.current);
    };
  }, [onToken]);

  if (!siteKey) return null;

  return (
    <div>
      <div ref={containerRef} />
      {error && <p className="text-sm text-signal">{error}</p>}
    </div>
  );
}

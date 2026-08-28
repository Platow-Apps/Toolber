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
/**
 * @param {object} props
 * @param {(token: string | null) => void} props.onToken
 * @param {number} [props.resetSignal]
 *   Bump this to issue a fresh token. A Turnstile token is single-use and
 *   short-lived: once an auth call has spent one, retrying with the same
 *   token fails with "timeout-or-duplicate" — while the widget still shows
 *   its green Success tick, because it has no idea the token was consumed.
 *   So every failed auth attempt has to reset it.
 */
export default function Turnstile({ onToken, resetSignal = 0 }) {
  const siteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY;
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const [error, setError] = useState("");

  // Held in a ref so the render effect below doesn't depend on it: a caller
  // passing an inline arrow would otherwise tear the widget down and
  // re-create it on every keystroke.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => setError("Verification failed to load — refresh and try again."),
        });
      })
      .catch(() => setError("Verification failed to load — refresh and try again."));

    return () => {
      cancelled = true;
      if (widgetIdRef.current != null) window.turnstile?.remove(widgetIdRef.current);
    };
    // Mount only: siteKey comes from import.meta.env, which is baked in at
    // build time and cannot change while this component is alive.
  }, []);

  useEffect(() => {
    // 0 is the initial render — nothing has been spent yet.
    if (!resetSignal || widgetIdRef.current == null || !window.turnstile) return;
    window.turnstile.reset(widgetIdRef.current);
    // Drop the spent token so the form can't resubmit it while the widget
    // is solving again.
    onTokenRef.current(null);
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div>
      <div ref={containerRef} />
      {error && <p className="text-sm text-signal">{error}</p>}
    </div>
  );
}

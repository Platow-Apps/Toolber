import { useState } from "react";
import { describePushFailure, dismissPushPrompt, enablePush } from "../lib/push";

/**
 * The soft prompt that precedes the browser's own.
 *
 * The browser's permission prompt is a one-shot: dismissed once, no script can
 * ever raise it again, and the person has to go digging in site settings. So
 * firing it on page load — before anyone knows what Toolber is — spends a
 * chance that cannot be got back, and Chrome additionally mutes the prompt for
 * sites that get denied a lot.
 *
 * This card is the buffer. Declining it costs nothing, because the real prompt
 * was never raised; only "Turn on" reaches it. It appears after someone's
 * first borrow request, which is the moment the question answers itself —
 * they have just done the thing that produces a reply worth hearing about.
 *
 * @param {object} props
 * @param {() => void} props.onClose  called however the card is dismissed
 */
export default function PushPrompt({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function turnOn() {
    setBusy(true);
    setError("");
    const result = await enablePush();
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    // Stay open on failure: the message is the only thing that explains why
    // nothing happened, and closing would take it away with it.
    setError(describePushFailure(result.reason, result.detail));
  }

  function notNow() {
    dismissPushPrompt();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-asphalt/40 px-4 pb-6 sm:items-center sm:pb-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-prompt-title"
        className="w-full max-w-sm rounded-lg border border-cardBorder bg-white p-4"
        style={{ clipPath: "polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)" }}
      >
        <h2
          id="push-prompt-title"
          className="mb-1.5 font-condensed text-lg font-bold uppercase tracking-wide text-asphalt"
        >
          Want push notifications?
        </h2>
        <p className="mb-3 text-[0.813rem] leading-relaxed text-ink">
          We'll ping you when the owner answers, and when it's time to arrange pickup. Email
          keeps working either way, and you can switch this off in Settings.
        </p>

        {error && (
          <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2.5 text-[0.688rem] leading-relaxed text-signal">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="flex-1 rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
          >
            {busy ? "Turning on…" : "Turn on"}
          </button>
          <button
            type="button"
            onClick={notNow}
            disabled={busy}
            className="flex-1 rounded-lg border border-steelLight py-3 font-condensed text-sm font-bold uppercase tracking-wide text-ink disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

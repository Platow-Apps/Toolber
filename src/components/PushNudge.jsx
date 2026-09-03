import { useEffect, useState } from "react";
import { pushEligible } from "../lib/push";
import PushPrompt from "./PushPrompt";

// Hidden for good once dismissed. Separate from the modal's own record: this
// row is passive, so turning it off is a statement about the row, not about
// push, and one should not silence the other.
const HIDDEN_KEY = "toolber:pushNudgeHidden";

function hidden() {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function hide() {
  try {
    window.localStorage.setItem(HIDDEN_KEY, "1");
  } catch {
    // Storage unavailable; the row simply comes back next visit.
  }
}

/**
 * A standing offer to turn push on, for the screen where waiting on a reply
 * is the whole point.
 *
 * The modal after a first borrow request is well-timed but easy to miss: it
 * appears once, and anything that already decided the permission — an earlier
 * "not now", a tap outside — takes it away with no trace that push exists at
 * all. Push then lives only in Settings, three taps from anywhere, which is
 * asking people to go looking for a feature they have not been told about.
 *
 * A row here is not that: My Tools is where a pending request sits, so "get
 * told when this is answered" is on the same screen as the thing being waited
 * on. Passive, one line, and dismissible for good.
 */
export default function PushNudge() {
  const [show, setShow] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (hidden()) return;
    let mounted = true;
    pushEligible().then((eligible) => {
      if (mounted) setShow(eligible);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!show) return null;

  return (
    <>
      <div className="mb-3.5 flex items-center gap-2.5 rounded-lg border border-cardBorder bg-panel px-3 py-2.5">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#F2B90B"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 flex-shrink-0"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <p className="flex-1 text-[0.719rem] leading-snug text-steelLight">
          Get a ping when someone answers, instead of checking back.
        </p>
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="flex-shrink-0 rounded-md bg-safety px-2.5 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt"
        >
          Turn on
        </button>
        <button
          type="button"
          onClick={() => {
            hide();
            setShow(false);
          }}
          aria-label="Hide this suggestion"
          className="flex-shrink-0 px-1 text-muted"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Reuses the modal rather than calling enablePush() directly, so there
          is one explanation of what push is and one place failures are worded. */}
      {asking && (
        <PushPrompt
          onClose={() => {
            setAsking(false);
            // Whatever they chose, this row has served its purpose: either
            // push is on, or they have just answered the question in full.
            hide();
            setShow(false);
          }}
        />
      )}
    </>
  );
}

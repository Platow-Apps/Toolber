import { useEffect, useState } from "react";
import { installMode, onInstallabilityChange, promptInstall } from "../lib/install";

// Hidden for good once dismissed. Installing is a suggestion, and a
// suggestion that keeps coming back is an advert.
const HIDDEN_KEY = "toolber:installNudgeHidden";

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
    // Storage unavailable; it simply comes back next visit.
  }
}

/**
 * An offer to add Toolber to the home screen.
 *
 * On an iPhone this is not decoration: Apple exposes the Push API only to a
 * web app that has been added to the Home Screen, so until someone does this,
 * Toolber cannot notify them at all and the push switch in Settings is not
 * even shown. That is the sentence this component exists to say.
 *
 * Two shapes, because the platforms are not comparable. Android and desktop
 * Chromium hand over an event we can replay against a button. iOS offers no
 * API whatsoever — the only route is the Share menu — so there the honest
 * thing is to describe the steps and get out of the way.
 */
export default function InstallNudge() {
  const [mode, setMode] = useState("none");
  const [dismissed, setDismissed] = useState(hidden);

  useEffect(() => {
    const update = () => setMode(installMode());
    update();
    // beforeinstallprompt can arrive after this mounts, and does on a cold
    // load — without this the nudge would stay hidden until a navigation.
    return onInstallabilityChange(update);
  }, []);

  if (dismissed || mode === "installed" || mode === "none") return null;

  return (
    <div className="mb-3.5 rounded-lg border border-cardBorder bg-panel px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#F2B90B"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 h-4 w-4 flex-shrink-0"
        >
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12" y2="18" />
        </svg>

        <div className="flex-1">
          <p className="text-[0.75rem] leading-snug text-steelLight">
            {mode === "ios-manual"
              ? "Add Toolber to your Home Screen to get notified when someone answers — on iPhone, notifications only work once it's installed."
              : "Add Toolber to your home screen for quicker access."}
          </p>

          {mode === "ios-manual" && (
            // No API exists for this on iOS, so the steps are the feature.
            // Named for Safari because that is where Add to Home Screen
            // reliably produces a real web app on iOS.
            <p className="mt-1.5 text-[0.719rem] leading-relaxed text-muted">
              In Safari, tap <b className="font-semibold text-asphalt">Share</b> (the square with an
              arrow), then <b className="font-semibold text-asphalt">Add to Home Screen</b>.
            </p>
          )}

          {mode === "prompt" && (
            <button
              type="button"
              onClick={async () => {
                await promptInstall();
                // Accepted or declined, the saved event is spent and cannot
                // be replayed — so stop offering rather than showing a
                // button that would now do nothing.
                hide();
                setDismissed(true);
              }}
              className="mt-1.5 rounded-md bg-safety px-2.5 py-1.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt"
            >
              Install
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            hide();
            setDismissed(true);
          }}
          aria-label="Hide this suggestion"
          className="flex-shrink-0 px-1 text-muted"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-3.5 w-3.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

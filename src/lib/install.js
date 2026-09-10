/**
 * Installing Toolber to a home screen, and knowing whether it already is.
 *
 * This matters more than "nice to have an icon", because on iPhone it is the
 * gate on push notifications. Apple exposes the Push API only to a web app
 * that has been added to the Home Screen — in any iOS browser tab, Safari or
 * Chrome, `PushManager` simply does not exist. So an iPhone visitor sees no
 * push switch in Settings and no explanation, which reads as a missing
 * feature rather than a missing step.
 *
 * The two platforms need opposite handling:
 *
 *   - Android and desktop Chromium fire `beforeinstallprompt`, which can be
 *     saved and replayed later against a button of our own. The browser's own
 *     mini-infobar is easy to miss, and cannot be re-shown once dismissed.
 *   - iOS fires nothing and offers no API. Installing is a manual trip through
 *     the Share menu, so the only honest thing to do is describe it.
 */

// Saved from the event, which fires once and early — long before any
// component that wants it has mounted. Captured at startup instead, and
// replayed on demand.
let deferredPrompt = null;
const listeners = new Set();

function announce() {
  for (const listener of listeners) listener();
}

/**
 * Start listening. Called once from main.jsx, before React mounts, because
 * the event can fire during initial page load and is not re-dispatched.
 */
export function watchInstallability() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this the browser shows its own bar and the event is spent.
    event.preventDefault();
    deferredPrompt = event;
    announce();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    announce();
  });
}

/** Subscribe to installability changes. Returns an unsubscribe function. */
export function onInstallabilityChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a browser-driven install prompt is available right now. */
export function canPromptInstall() {
  return deferredPrompt !== null;
}

/**
 * Show the browser's install prompt.
 *
 * @returns {Promise<boolean>} whether it was accepted. The saved event is
 *   single-use either way — a declined prompt cannot be replayed, which is
 *   why the caller should stop offering it rather than asking again.
 */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  announce();
  try {
    event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/**
 * Already running as an installed app.
 *
 * Two checks because the standards did not agree: `display-mode: standalone`
 * is the modern one, and `navigator.standalone` is Apple's original, still
 * the only reliable answer on iOS.
 */
export function isStandalone(win = typeof window === "undefined" ? null : window) {
  if (!win) return false;
  if (win.navigator?.standalone === true) return true;
  try {
    return win.matchMedia?.("(display-mode: standalone)")?.matches === true;
  } catch {
    return false;
  }
}

/**
 * An iOS device, including iPads pretending to be desktops.
 *
 * iPadOS 13 onwards reports a Macintosh user agent, so the touch-point count
 * is what separates an iPad from a Mac — a Mac reports 0. Checked before the
 * plain iPhone/iPad match because that match will not fire on a modern iPad.
 */
export function isIos(nav = typeof navigator === "undefined" ? null : navigator) {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return ua.includes("Macintosh") && (nav.maxTouchPoints ?? 0) > 1;
}

/**
 * What to offer someone about installing.
 *
 * "installed"  — already a home-screen app; say nothing.
 * "prompt"     — the browser gave us an event to replay.
 * "ios-manual" — iPhone or iPad, where the only route is the Share menu.
 * "none"       — nothing useful to offer, so offer nothing.
 */
export function installMode({ win, nav } = {}) {
  const w = win ?? (typeof window === "undefined" ? null : window);
  const n = nav ?? (typeof navigator === "undefined" ? null : navigator);
  if (isStandalone(w)) return "installed";
  if (canPromptInstall()) return "prompt";
  if (isIos(n)) return "ios-manual";
  return "none";
}

/**
 * Whether push is unavailable *only* because the app is not installed.
 *
 * The distinction the Settings screen needs: on iOS this is a missing step
 * someone can take, everywhere else a browser without push is simply a
 * browser without push, and telling them to install would not help.
 */
export function pushNeedsInstall({ win, nav } = {}) {
  const w = win ?? (typeof window === "undefined" ? null : window);
  const n = nav ?? (typeof navigator === "undefined" ? null : navigator);
  return isIos(n) && !isStandalone(w);
}

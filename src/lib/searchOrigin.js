/**
 * Where search measures distance from.
 *
 * Three sources, in order:
 *
 *   1. A place the person chose — typed into "Search near", or taken from the
 *      device. Remembered on this device.
 *   2. Their own approximate point, the same fuzzed coordinate their map pin
 *      uses. Needs no permission prompt and no typing, so it is the default
 *      for anyone signed in.
 *   3. Nothing, for a signed-out visitor who has not chosen. Results stay in
 *      newest-first order, exactly as before.
 *
 * Deliberately not stored on the profile. A search origin is a "where am I
 * looking right now" decision — someone helping their parents move, or
 * checking what is available near a holiday rental — and making it a permanent
 * account setting would be a worse fit than a per-device one.
 */

const STORAGE_KEY = "toolber:searchOrigin";

/** The chosen origin for this device, or null. */
export function storedOrigin() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard the shape rather than trusting it: this survives across deploys,
    // and a half-written value would otherwise be handed to the RPC.
    if (typeof parsed?.lat !== "number" || typeof parsed?.lng !== "number") return null;
    return { lat: parsed.lat, lng: parsed.lng, label: parsed.label || "your chosen area" };
  } catch {
    return null;
  }
}

/** Remember a chosen origin on this device. */
export function storeOrigin(origin) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(origin));
  } catch {
    // Private browsing, or storage disabled. The origin still applies for this
    // visit; it just will not be remembered.
  }
}

/** Forget the chosen origin, falling back to the profile's own point. */
export function clearStoredOrigin() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The origin to search from, given the signed-in profile (or null).
 *
 * @returns {{lat: number, lng: number, label: string} | null}
 */
export function resolveOrigin(profile) {
  const chosen = storedOrigin();
  if (chosen) return chosen;

  if (typeof profile?.approx_lat === "number" && typeof profile?.approx_lng === "number") {
    return { lat: profile.approx_lat, lng: profile.approx_lng, label: "your area" };
  }

  return null;
}

/**
 * Ask the browser where the device is.
 *
 * Wrapped rather than used directly because the callback API is awkward and
 * because every failure here is something the UI has to explain — a denied
 * permission reads very differently from a timeout, and "couldn't get your
 * location" covers both badly.
 *
 * @returns {Promise<{ok: true, lat: number, lng: number} | {ok: false, reason: string}>}
 */
export function locateDevice() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const reason = err?.code === 1 ? "denied" : err?.code === 3 ? "timeout" : "unavailable";
        resolve({ ok: false, reason });
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

/** Human-readable reason a location lookup failed. */
export function describeLocateFailure(reason) {
  switch (reason) {
    case "unsupported":
      return "This browser can't share your location. Type a place instead.";
    case "denied":
      return "Location is blocked for Toolber. You can allow it in your browser's site settings, or just type a place.";
    case "timeout":
      return "That took too long. Try again, or type a place.";
    default:
      return "Couldn't work out where you are. Type a place instead.";
  }
}

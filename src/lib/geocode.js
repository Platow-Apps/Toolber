/**
 * Forward geocoding via Mapbox.
 *
 * Two callers want this and they want it for opposite reasons, which is worth
 * keeping straight:
 *
 * - Onboarding turns a member's real address into a point that is immediately
 *   jittered and then never shown. The precise result is private.
 * - Groups turn the neighborhood/city/zip the admin typed into a public map
 *   pin. That result is deliberately coarse and deliberately public — it
 *   describes an area, not a person, which is exactly why a group's pin must
 *   not be derived from where its members live.
 *
 * Mapbox is already the app's map provider, so this introduces no new service.
 */

/**
 * @param {string} address  a single line, e.g. "Oakhill, Dover, DE 19901"
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} with a message fit to show a person
 */
export async function geocodeAddress(address) {
  // Optional chaining: import.meta.env is a Vite-only feature and is simply
  // undefined under the AVA/tsx test runner. A missing or bad token still
  // fails gracefully below via the same !res.ok / !feature checks a real
  // misconfiguration would hit, so no separate guard is needed here.
  const token = import.meta.env?.VITE_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't reach the address lookup service. Try again.");

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error("Couldn't find that address — try adding city and state.");

  const [lng, lat] = feature.center;
  return { lat, lng };
}

/**
 * The one line a group's map pin is placed from.
 *
 * Neighborhood first, because that is the most specific thing a group states
 * about itself, then city and zip to disambiguate it. Returns "" when the
 * admin filled in none of them, which the caller must treat as "no pin" rather
 * than geocoding an empty string.
 */
export function groupAreaQuery({ neighborhood_label, city, zip_code } = {}) {
  return [neighborhood_label, city, zip_code]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

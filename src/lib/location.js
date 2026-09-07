import { supabase } from "./supabaseClient";
import { geocodeAddress } from "./geocode";

/**
 * Setting where you are — the one path, used by onboarding and by Settings.
 *
 * The jitter used to live in Onboarding.jsx as a local function. Adding a
 * second place to set an area would have meant a second copy of it, and the
 * two drifting is not a cosmetic bug: the fuzzing *is* the privacy model, so a
 * copy that rounds differently, or forgets the sqrt, publishes people's
 * addresses. It now happens once, in Postgres (0045).
 *
 * What is left here is the part that genuinely belongs to the client: turning
 * what someone typed into a point.
 */

/** ~0.5 mi. What onboarding has always used. */
export const DEFAULT_RADIUS_METERS = 800;

/**
 * Offered radii. Spelled in miles because that is how anyone describes how far
 * away a neighbor is, and stored in metres because that is what the maths and
 * the schema use.
 *
 * Each carries the consequence rather than only the distance, because the
 * trade-off is not linear and nobody should have to work that out: hiding
 * happens over an *area*, so halving the radius quarters it. A quarter mile is
 * ~0.5 km² of possible real locations; a half mile is ~2 km². Both are real
 * choices — a quarter mile is a genuinely more useful pin — but the cost of
 * the tighter one is four times larger than it looks.
 */
export const RADIUS_CHOICES = [
  { meters: 400, label: "About ¼ mile", note: "Closer, but a quarter of the area to hide in" },
  { meters: 800, label: "About ½ mile", note: "The default — about 2 km² of possible spots" },
  { meters: 1600, label: "About 1 mile", note: "Vaguest, and hardest for a neighbor to judge" },
];

/**
 * Join address parts into the single line the geocoder wants.
 *
 * Unit and apartment numbers are dropped deliberately: they never help place a
 * point and often confuse the lookup.
 */
export function addressLine({ street, city, state, zip }) {
  return [street, city, state, zip]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Geocode an address and save it as the caller's area.
 *
 * Never throws — both failures a person can actually cause (an address the
 * geocoder cannot place, and a write the server refuses) come back as a
 * message fit to show them.
 *
 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
 */
export async function saveArea(address, radiusMeters = DEFAULT_RADIUS_METERS) {
  let point;
  try {
    point = await geocodeAddress(address);
  } catch (err) {
    // geocodeAddress throws copy already written for a person.
    return { ok: false, message: err.message };
  }

  const { error } = await supabase.rpc("set_my_area", {
    p_lat: point.lat,
    p_lng: point.lng,
    p_radius_meters: radiusMeters,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

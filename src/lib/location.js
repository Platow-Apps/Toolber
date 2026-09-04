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
 */
export const RADIUS_CHOICES = [
  { meters: 400, label: "About ¼ mile" },
  { meters: 800, label: "About ½ mile" },
  { meters: 1600, label: "About 1 mile" },
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

import { geocodeAddress } from "./geocode";
import { supabase } from "./supabaseClient";

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
 * ¼ and ½ are single glyphs and were reported as hard to tell apart. The
 * fix is size, not spelling: these render at 0.813rem in a radio list rather
 * than at 0.594rem inside a dropdown, which is where they were illegible.
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
 * @param {boolean} certified  the person has confirmed the address is theirs
 *   and correct. Not optional in practice: set_my_area refuses without it.
 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
 */
export async function saveArea(address, radiusMeters = DEFAULT_RADIUS_METERS, certified = false) {
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
    // Refused server-side when false (0050), so a form that forgets to ask
    // fails loudly rather than recording an attestation nobody made.
    p_certified: certified,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Save one of the owner's named places — a cabin, a shop, a second home.
 *
 * The same shape as saveArea() one level down: geocode in the browser, send
 * coordinates. The street address never reaches the database as part of the
 * *area*; only the pickup address does, and only because the owner chose to
 * save one for handovers.
 *
 * save_my_location() re-jitters the public pin only when the address or radius
 * actually moved, so renaming a place leaves its pin exactly where it was.
 * That matters: a pin rerolled on every save would let repeated saves average
 * out to the real address, which is the whole reason the jitter is stored
 * rather than computed on read.
 *
 * @param {object} place
 * @param {string} place.label            what the owner calls it
 * @param {string} place.address          the street address, geocoded here
 * @param {number} [place.radiusMeters]
 * @param {string} [place.pickupAddress]  handover address for this place
 * @param {string} [place.id]             omit to create, pass to update
 * @returns {Promise<{ok: true, id: string} | {ok: false, message: string}>}
 */
export async function saveLocation({
  label,
  address,
  radiusMeters = DEFAULT_RADIUS_METERS,
  pickupAddress = null,
  id = null,
}) {
  let point;
  try {
    point = await geocodeAddress(address);
  } catch (err) {
    // geocodeAddress throws copy already written for a person.
    return { ok: false, message: err.message };
  }

  const { data, error } = await supabase.rpc("save_my_location", {
    p_label: label,
    p_lat: point.lat,
    p_lng: point.lng,
    p_radius_meters: radiusMeters,
    p_pickup_address: pickupAddress,
    p_id: id,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data };
}

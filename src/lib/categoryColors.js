import { CATEGORY_TREE } from "./toolCategories";

/**
 * Map pin colour, one per category.
 *
 * Hues are spread evenly across the wheel and handed out in alphabetical
 * order, so no two categories share one and the gap between the closest pair
 * is as wide as 39 colours allow — about 8 degrees.
 *
 * Golden-angle spacing was tried and is worse here. It maximises the
 * difference between *consecutive* entries, which would matter for a list
 * shown in order; a map shows categories in no order at all, so what counts
 * is the closest pair anywhere, and stepping by 137.5 degrees drops that from
 * 8 degrees to 3. A hash of the name was the first attempt: it survives the
 * taxonomy changing, but with 39 names over ~340 usable hues a collision is
 * near-certain, and two categories wearing the same colour is exactly what
 * this is meant to avoid.
 *
 * The cost is that adding a category shifts the others' hues. That is fine —
 * pin colour is decoration that makes the map scannable, not a code anyone
 * memorises, and the taxonomy changes about once a season.
 *
 * Saturation and lightness are fixed, so all 39 read as one palette at
 * different hues rather than unrelated swatches. That is also what keeps them
 * legible at pin size: each is dark enough for the white pin outline to hold,
 * and for the glyph to show against the pin's white centre.
 *
 * Nothing names the colour anywhere, and there is no legend. A different
 * colour meaning a different kind of thing needs no explaining, and every pin
 * already carries the tool's own name — so nobody has to decode a hue to use
 * the map, which is also what keeps it fine for anyone who cannot tell these
 * apart.
 */

// Matches the Motorsport palette's weight: saturated enough to be distinct,
// dark enough to carry a white stroke and a white-centred badge.
const SATURATION = 62;
const LIGHTNESS = 41;

// Group pins are #2878B8 — hue 207. Tool hues skip a band around it, so a tool
// is never mistaken for a group; those are the two things on this map.
const GROUP_HUE = 207;
const GROUP_HUE_GUARD = 14;

/** Grey, for a category the taxonomy no longer lists, or none at all. */
const UNKNOWN_COLOR = "hsl(0, 0%, 48%)";

const HUE_BY_CATEGORY = (() => {
  // Alphabetical rather than CSV order: the file is generated, and its order
  // is an implementation detail that could change without anyone meaning to.
  const names = CATEGORY_TREE.map((c) => c.category).sort();
  const usable = 360 - GROUP_HUE_GUARD * 2;

  const map = new Map();
  names.forEach((name, i) => {
    const raw = Math.round(i * (usable / Math.max(names.length, 1)));
    // Skip the group band by compressing the wheel, so the spacing stays even
    // instead of two categories being nudged onto the same edge hue.
    map.set(name, raw < GROUP_HUE - GROUP_HUE_GUARD ? raw : raw + GROUP_HUE_GUARD * 2);
  });
  return map;
})();

/** CSS colour for a category's map pin. Always returns something. */
export function categoryColor(category) {
  const hue = HUE_BY_CATEGORY.get((category ?? "").trim());
  // An unlisted or missing category still needs a pin — a tool listed before a
  // rename must not vanish from the map.
  if (hue === undefined) return UNKNOWN_COLOR;
  return `hsl(${hue}, ${SATURATION}%, ${LIGHTNESS}%)`;
}

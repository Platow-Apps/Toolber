import { CATEGORY_TREE } from "./toolCategories";

/**
 * Guess a tool's category from its name.
 *
 * A tool's name usually *is* its category — "heat gun" belongs under "Heat
 * guns & torches", "circular saw" under saws — so making someone hunt through
 * 38 categories and several hundred subcategories to say what they have just
 * typed is asking them to do the app's arithmetic.
 *
 * Deliberately a suggestion and never an assignment, and deliberately tuned to
 * stay quiet rather than to guess. A wrong suggestion is worse than none,
 * because it gets accepted: it takes one tap and looks like the app knows
 * something. So the bar below rejects several names it could half-answer —
 * "cordless drill", "paint sprayer" — where the best string match was the
 * wrong tool. Silence there costs a few seconds of scrolling; a plausible
 * wrong answer mis-files the tool and makes search worse, which is the one
 * thing this is meant to improve.
 *
 * Matching is local and string-based: no request, no model, nothing to be
 * slow or unavailable while someone is typing.
 */

// Words that appear across so many subcategories that matching on them says
// nothing. "Tool" alone would tie half the taxonomy for first place.
const STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "for", "with", "of", "to",
  "tool", "tools", "accessories", "accessory", "other", "misc", "general",
  "equipment", "supplies", "parts", "kit", "kits", "set", "sets",
]);

/**
 * Words a name and a category can be compared by.
 *
 * Crude singularisation: trailing "s" is dropped from words over three
 * letters, so "guns" matches "gun" and "saws" matches "saw" without a
 * dictionary. It mangles a few words ("gas" -> "ga") but only ever compares
 * mangled forms against each other, so both sides mangle identically and the
 * comparison still holds.
 */
export function tokenize(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

/**
 * How well a name matches one category or subcategory label.
 *
 * Scored on the *label's* side rather than the name's: "Heat guns & torches"
 * has three meaningful words and a name matching two of them is a strong
 * signal, while a name matching two words of a twelve-word label is not. The
 * bonus for matching every word of the label is what puts an exact "heat gun"
 * above a partial "gun" match elsewhere.
 */
function scoreLabel(nameTokens, label) {
  const labelTokens = tokenize(label);
  if (labelTokens.length === 0) return 0;

  const nameSet = new Set(nameTokens);
  const hits = labelTokens.filter((word) => nameSet.has(word)).length;
  if (hits === 0) return 0;

  // One shared word is almost always a coincidence of English rather than a
  // match. "Cordless drill" shares exactly one word with "Drill presses", and
  // scored highest against it purely because that label is short — filing a
  // handheld drill under Machining. A single-word overlap only counts when it
  // covers the *whole* label ("Mowers" from "lawn mower"), where there is
  // nothing left for it to have missed.
  const coverage = hits / labelTokens.length;
  if (hits < 2 && coverage < 1) return 0;

  return coverage === 1 ? coverage + 0.5 : coverage;
}

/**
 * Best category (and subcategory, when one matched) for a tool name.
 *
 * @returns {{category: string, subcategory: string|null, score: number} | null}
 *   null when nothing scored above the threshold, which is the common case
 *   for a short or unusual name and is not a failure.
 */
export function suggestCategory(name) {
  const nameTokens = tokenize(name);
  // One meaningful word can match, but a bare "saw" should not out-argue the
  // person; the threshold below is what keeps a single weak hit quiet.
  if (nameTokens.length === 0) return null;

  let best = null;

  for (const { category, subcategories } of CATEGORY_TREE) {
    // A subcategory is the more specific claim, so it is tried first and its
    // score is taken as the category's when it wins.
    for (const subcategory of subcategories ?? []) {
      const score = scoreLabel(nameTokens, subcategory);
      if (score > 0 && (!best || score > best.score)) {
        best = { category, subcategory, score };
      }
    }

    // Slightly discounted against a subcategory of equal coverage: "Saws &
    // Blades" matching "saw" is true but tells the person less than "Circular
    // saws" would.
    const score = scoreLabel(nameTokens, category) * 0.9;
    if (score > 0 && (!best || score > best.score)) {
      best = { category, subcategory: null, score };
    }
  }

  // 0.5 admits a half-covered two-word label ("Heat guns & torches" from
  // "heat gun" scores well above it) while rejecting a single word matched
  // out of four, which is usually a coincidence.
  return best && best.score >= 0.5 ? best : null;
}

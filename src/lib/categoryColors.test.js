import test from "ava";
import { CATEGORY_TREE } from "./toolCategories.js";
import { categoryColor } from "./categoryColors.js";

const ALL = CATEGORY_TREE.map((c) => c.category);
const hueOf = (color) => Number(color.match(/hsl\((\d+)/)?.[1]);

test("every category gets a colour", (t) => {
  // The taxonomy is generated from a CSV, so this has to hold for whatever is
  // in it — there is no hand-maintained list to fall out of step with.
  for (const category of ALL) {
    t.regex(categoryColor(category), /^hsl\(\d+, \d+%, \d+%\)$/, category);
  }
});

test("a category always gets the same colour", (t) => {
  t.is(categoryColor("Power Tools"), categoryColor("Power Tools"));
  t.not(categoryColor("Power Tools"), categoryColor("Plumbing"));
});

test("the closest pair is as far apart as 39 colours allow", (t) => {
  // A map shows categories in no particular order, so any two pins can end up
  // side by side — what matters is the closest pair anywhere on the wheel, not
  // the gap between consecutive names.
  const hues = ALL.map((c) => hueOf(categoryColor(c))).sort((a, b) => a - b);
  const gaps = hues.slice(1).map((h, i) => h - hues[i]);
  t.true(Math.min(...gaps) >= 6, `smallest gap is ${Math.min(...gaps)} degrees`);
});

test("no category lands on the group pin's blue", (t) => {
  // Groups are #2878B8, hue 207. A tool wearing that would read as a group,
  // and those are the only two things on this map.
  for (const category of ALL) {
    const hue = hueOf(categoryColor(category));
    t.true(Math.abs(hue - 207) >= 12, `${category} is hue ${hue}, too close to the group blue`);
  }
});

test("no two categories share a hue", (t) => {
  const hues = ALL.map((c) => hueOf(categoryColor(c)));
  const duplicates = hues.filter((h, i) => hues.indexOf(h) !== i);
  t.deepEqual(duplicates, [], `hues used twice: ${duplicates.join(", ")}`);
});

test("the hues spread across the wheel rather than clumping", (t) => {
  // A hash can in principle bunch up, and visible variety is the whole point.
  const hues = ALL.map((c) => hueOf(categoryColor(c)));
  const quadrants = new Set(hues.map((h) => Math.floor(h / 90)));
  t.is(quadrants.size, 4, "every quarter of the colour wheel should be used");
});

test("every colour is dark enough to carry the pin's white outline", (t) => {
  for (const category of ALL) {
    const lightness = Number(categoryColor(category).match(/(\d+)%\)$/)[1]);
    t.true(lightness <= 55, `${category} is too light for a white stroke`);
  }
});

test("an unknown or missing category still gets a pin", (t) => {
  // A tool listed before a category was renamed must not vanish from the map.
  t.regex(categoryColor("Nonexistent Category"), /^hsl\(/);
  t.regex(categoryColor(null), /^hsl\(/);
  t.regex(categoryColor(undefined), /^hsl\(/);
  t.regex(categoryColor("   "), /^hsl\(/);
});

test("a missing category is grey, not a colour that implies one", (t) => {
  t.is(categoryColor(null), categoryColor(""));
  t.regex(categoryColor(null), /0%/);
});


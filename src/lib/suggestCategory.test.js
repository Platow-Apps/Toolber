import test from "ava";
import { suggestCategory, tokenize } from "./suggestCategory.js";

test("a tool's name usually is its category", (t) => {
  // The whole premise. If these stop holding, the suggestion is not worth
  // showing at all.
  const cases = [
    ["Heat Gun", "Heat guns & torches"],
    ["heat gun", "Heat guns & torches"],
    ["Pressure washer", "Pressure washers"],
    ["Air compressor", "Air compressors"],
  ];
  for (const [name, subcategory] of cases) {
    const got = suggestCategory(name);
    t.truthy(got, `${name} suggested nothing`);
    t.is(got.subcategory, subcategory, name);
  }
});

test("plurals and singulars match each other", (t) => {
  t.is(suggestCategory("heat guns")?.subcategory, "Heat guns & torches");
  t.is(suggestCategory("pressure washers")?.subcategory, "Pressure washers");
});

test("punctuation and extra words do not throw it off", (t) => {
  // Real listings are named "DeWalt heat gun (1500W)", not "Heat gun".
  t.is(suggestCategory("DeWalt Heat Gun, 1500W")?.subcategory, "Heat guns & torches");
});

test("says nothing rather than guessing at an unmatchable name", (t) => {
  // Null is the common case for a short or unusual name and is not a failure —
  // a wrong suggestion is worse than none, because it gets accepted.
  t.is(suggestCategory("Whatsit"), null);
  t.is(suggestCategory(""), null);
  t.is(suggestCategory(null), null);
  t.is(suggestCategory("   "), null);
});

test("a word that means nothing on its own suggests nothing", (t) => {
  // "Tool" and friends appear across so much of the taxonomy that matching on
  // them would tie half of it for first place.
  t.is(suggestCategory("tool"), null);
  t.is(suggestCategory("kit"), null);
  t.is(suggestCategory("accessories"), null);
});

test("a suggestion always names a category, subcategory optional", (t) => {
  // ListTool sets both, so a suggestion missing the parent would half-fill
  // the form.
  const got = suggestCategory("Heat Gun");
  t.truthy(got.category);
  t.true(typeof got.category === "string" && got.category.length > 0);
});

test("tokenize drops noise and normalises plurals", (t) => {
  t.deepEqual(tokenize("Heat Guns & Torches"), ["heat", "gun", "torche"]);
  t.deepEqual(tokenize("The Tool Kit"), []);
});

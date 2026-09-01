import test from "ava";
import { groupAreaQuery } from "./geocode.js";

// groupAreaQuery is what decides where a group lands on the map, and getting
// it wrong is not a cosmetic bug -- an empty query would geocode "" and pin a
// group somewhere arbitrary.

test("joins the parts a group states about itself, most specific first", (t) => {
  t.is(
    groupAreaQuery({ neighborhood_label: "Oak Hill", city: "Dover", zip_code: "19901" }),
    "Oak Hill, Dover, 19901"
  );
});

test("skips the parts that were left blank", (t) => {
  t.is(groupAreaQuery({ neighborhood_label: null, city: "Dover", zip_code: "" }), "Dover");
  t.is(groupAreaQuery({ neighborhood_label: "  ", city: null, zip_code: "19901" }), "19901");
});

test("returns empty when the group states no area at all", (t) => {
  // The caller treats this as "no pin" rather than geocoding an empty string.
  t.is(groupAreaQuery({}), "");
  t.is(groupAreaQuery(), "");
  t.is(groupAreaQuery({ neighborhood_label: null, city: null, zip_code: null }), "");
});

test("a zip alone is enough to place a group", (t) => {
  // The common case for a group that has not filled anything else in.
  t.is(groupAreaQuery({ zip_code: "19901" }), "19901");
});

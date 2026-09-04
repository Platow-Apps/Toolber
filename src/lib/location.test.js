import test from "ava";
import { addressLine, DEFAULT_RADIUS_METERS, RADIUS_CHOICES } from "./location.js";

test("joins the parts a geocoder needs, skipping what is missing", (t) => {
  t.is(
    addressLine({ street: "123 Oak St", city: "Santa Rosa", state: "CA", zip: "95404" }),
    "123 Oak St, Santa Rosa, CA, 95404"
  );
  t.is(addressLine({ street: "123 Oak St", city: "Santa Rosa", state: "CA" }), "123 Oak St, Santa Rosa, CA");
});

test("trims, so a stray space does not become an empty address part", (t) => {
  t.is(addressLine({ street: " 123 Oak St ", city: " ", state: "CA" }), "123 Oak St, CA");
});

test("survives missing fields entirely", (t) => {
  t.is(addressLine({}), "");
  t.is(addressLine({ city: null, street: undefined, state: "CA" }), "CA");
});

test("the default radius is one of the choices offered", (t) => {
  // Otherwise Settings opens showing a radius the select cannot represent, and
  // silently changes it the moment anything else is saved.
  t.true(RADIUS_CHOICES.some((c) => c.meters === DEFAULT_RADIUS_METERS));
});

test("every radius is inside what the server will accept", (t) => {
  // set_my_area() rejects anything outside 200–5000 m; a choice outside that
  // would be an error nobody could resolve from the UI.
  for (const choice of RADIUS_CHOICES) {
    t.true(choice.meters >= 200 && choice.meters <= 5000, choice.label);
  }
});

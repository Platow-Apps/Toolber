import test from "ava";
import { distanceMiles, formatDistance } from "./geo.js";

// ─── distanceMiles ───────────────────────────────────────────────────

test("returns 0 for the same point", (t) => {
  t.is(distanceMiles(38.44, -122.71, 38.44, -122.71), 0);
});

test("returns null when any coordinate is missing", (t) => {
  t.is(distanceMiles(null, -122.71, 38.44, -122.71), null);
  t.is(distanceMiles(38.44, null, 38.44, -122.71), null);
  t.is(distanceMiles(38.44, -122.71, undefined, -122.71), null);
  t.is(distanceMiles(38.44, -122.71, 38.44, undefined), null);
});

test("treats 0 as a real coordinate, not a missing one", (t) => {
  // Null Island is a legitimate lat/lng — the guard uses `== null`, so this
  // must not collapse to null the way a falsy check would.
  t.not(distanceMiles(0, 0, 38.44, -122.71), null);
});

test("matches a known distance (Santa Rosa → San Francisco ≈ 50 mi)", (t) => {
  const miles = distanceMiles(38.4404, -122.7141, 37.7749, -122.4194);
  t.true(miles > 47 && miles < 52, `expected ~50 mi, got ${miles}`);
});

test("is symmetric", (t) => {
  const ab = distanceMiles(38.44, -122.71, 37.77, -122.42);
  const ba = distanceMiles(37.77, -122.42, 38.44, -122.71);
  t.is(ab.toFixed(6), ba.toFixed(6));
});

test("handles antipodal points without NaN", (t) => {
  const miles = distanceMiles(0, 0, 0, 180);
  t.false(Number.isNaN(miles));
  t.true(miles > 12000);
});

// ─── formatDistance ──────────────────────────────────────────────────

test("formatDistance returns null for null", (t) => {
  t.is(formatDistance(null), null);
});

test("formatDistance says Nearby under a tenth of a mile", (t) => {
  t.is(formatDistance(0), "Nearby");
  t.is(formatDistance(0.099), "Nearby");
});

test("formatDistance renders one decimal place with a unit", (t) => {
  t.is(formatDistance(0.1), "0.1 mi away");
  t.is(formatDistance(4.26), "4.3 mi away");
  t.is(formatDistance(12), "12.0 mi away");
});

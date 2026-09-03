import test from "ava";
import "../../test/support/polyfills.js";

import {
  deviceDotElement,
  FAN_OUT_METERS, POPUP_Z_INDEX, clusterByCoordinate, fanOutDelta, groupPopupElement, isFocused, loadMapView, pinElement, pinZIndex, plottablePoints, saveMapView, toolPopupElement } from "./mapPins.js";

const withPin = (overrides = {}) => ({
  id: "tool-1",
  name: "Circular saw",
  profiles: { display_name: "Jim B.", approx_lat: 38.48, approx_lng: -122.75, map_pin_hidden: false },
  ...overrides,
});

// ─── plottablePoints ─────────────────────────────────────────────────

test("plots a tool at its owner's persisted approximate point", (t) => {
  const [point] = plottablePoints([withPin()], []);
  t.is(point.type, "tool");
  t.is(point.lat, 38.48);
  t.is(point.lng, -122.75);
});

test("never plots a chest that hid its pin", (t) => {
  const hidden = withPin({
    profiles: { display_name: "Ana R.", approx_lat: 38.48, approx_lng: -122.75, map_pin_hidden: true },
  });
  t.deepEqual(plottablePoints([hidden], []), []);
});

test("skips a chest with no approximate point at all", (t) => {
  const noPin = withPin({ profiles: { display_name: "Ana R.", approx_lat: null, approx_lng: null } });
  t.deepEqual(plottablePoints([noPin], []), []);
});

test("skips a tool with no profiles join", (t) => {
  t.deepEqual(plottablePoints([{ id: "t", name: "x" }], []), []);
});

test("plots groups alongside tools", (t) => {
  const points = plottablePoints([withPin()], [{ id: "g1", name: "Oak Hill", approx_lat: 38.4, approx_lng: -122.7 }]);
  t.is(points.length, 2);
  t.deepEqual(
    points.map((p) => p.type),
    ["tool", "group"]
  );
});

test("treats 0,0 as a real coordinate", (t) => {
  const nullIsland = withPin({
    profiles: { display_name: "N", approx_lat: 0, approx_lng: 0, map_pin_hidden: false },
  });
  t.is(plottablePoints([nullIsland], []).length, 1);
});

// ─── clusterByCoordinate ─────────────────────────────────────────────

test("buckets pins that share a coordinate", (t) => {
  const points = [
    { lat: 38.48, lng: -122.75, type: "tool", data: { id: 1 } },
    { lat: 38.48, lng: -122.75, type: "group", data: { id: 2 } },
    { lat: 37.77, lng: -122.41, type: "tool", data: { id: 3 } },
  ];
  const clusters = clusterByCoordinate(points);
  t.is(clusters.length, 2);
  t.is(clusters[0].length, 2);
  t.is(clusters[1].length, 1);
});

test("treats coordinates within ~11m as co-located", (t) => {
  const points = [
    { lat: 38.480001, lng: -122.750001, type: "tool", data: { id: 1 } },
    { lat: 38.480002, lng: -122.750002, type: "tool", data: { id: 2 } },
  ];
  t.is(clusterByCoordinate(points).length, 1);
});

// ─── fanOutDelta ─────────────────────────────────────────────────────

test("does not move a pin that has no neighbours", (t) => {
  t.deepEqual(fanOutDelta("tool-1", 1, 38.48), { dLat: 0, dLng: 0 });
});

test("displaces a co-located pin by roughly the configured distance", (t) => {
  const lat = 38.48;
  const { dLat, dLng } = fanOutDelta("tool-1", 2, lat);

  const metresNorth = dLat * 111320;
  const metresEast = dLng * 111320 * Math.cos((lat * Math.PI) / 180);
  const distance = Math.hypot(metresNorth, metresEast);

  t.true(Math.abs(distance - FAN_OUT_METERS) < 0.5, `expected ~${FAN_OUT_METERS} m, got ${distance}`);
});

test("is a geographic delta, not a pixel offset — the pin must not move with zoom", (t) => {
  // The regression this guards: the fan-out used to be a constant 16px
  // `Marker#offset`, which is ~240 m of ground at zoom 13 and ~30 m at zoom 16,
  // so a co-located pair visibly slid across the basemap while zooming.
  const delta = fanOutDelta("tool-1", 2, 38.48);
  t.is(typeof delta.dLat, "number");
  t.is(typeof delta.dLng, "number");
  t.false(Array.isArray(delta), "a [x, y] pixel tuple would reintroduce the bug");
});

test("is stable across calls, so a pin never jumps between reloads", (t) => {
  const a = fanOutDelta("tool-1", 2, 38.48);
  const b = fanOutDelta("tool-1", 2, 38.48);
  t.deepEqual(a, b);
});

test("does not depend on position within the cluster", (t) => {
  // Order comes from two independent queries; if the angle depended on index,
  // a pin would move whenever the query order changed.
  t.deepEqual(fanOutDelta("tool-1", 2, 38.48), fanOutDelta("tool-1", 5, 38.48));
});

test("sends different ids in different directions", (t) => {
  const a = fanOutDelta("tool-1", 2, 38.48);
  const b = fanOutDelta("group-1", 2, 38.48);
  t.notDeepEqual(a, b);
});

test("stays well inside the jitter radius the pin already carries", (t) => {
  // The public pin is jittered by up to 800 m, so a 30 m nudge reveals nothing.
  const { dLat } = fanOutDelta("tool-1", 2, 38.48);
  t.true(Math.abs(dLat * 111320) < 100);
});

test("widens longitude towards the poles so the offset stays circular", (t) => {
  const equator = fanOutDelta("tool-1", 2, 0);
  const high = fanOutDelta("tool-1", 2, 60);
  t.true(Math.abs(high.dLng) > Math.abs(equator.dLng));
});

test("survives a near-polar latitude without dividing by zero", (t) => {
  const { dLng } = fanOutDelta("tool-1", 2, 90);
  t.false(Number.isNaN(dLng));
  t.true(Number.isFinite(dLng));
});

// ─── isFocused ───────────────────────────────────────────────────────

test("matches the focused point by type and id", (t) => {
  const point = { type: "tool", data: { id: "tool-1" } };
  t.true(isFocused({ type: "tool", id: "tool-1" }, point));
  t.false(isFocused({ type: "group", id: "tool-1" }, point));
  t.false(isFocused({ type: "tool", id: "tool-2" }, point));
  t.false(isFocused(null, point));
});

test("compares ids as strings, since they arrive from the URL", (t) => {
  t.true(isFocused({ type: "tool", id: "7" }, { type: "tool", data: { id: 7 } }));
});

// ─── pinElement ──────────────────────────────────────────────────────

const makePin = (overrides = {}) =>
  pinElement({ size: 26, color: "#F2790B", iconPaths: "<g/>", label: "Jim B.", ...overrides });

test("never sets an inline position on the marker root", (t) => {
  // THE regression guard. mapbox-gl positions markers with a stylesheet rule
  // (`.mapboxgl-marker { position: absolute }`), and an inline style beats a
  // stylesheet — so an inline `position` here drops every marker back into
  // normal flow, adding its static flow offset on top of mapbox's transform.
  // A constant screen offset is a varying ground offset, which is why the pins
  // slid across the basemap while zooming.
  t.is(makePin().style.position, "");
});

test("sizes the root to the pin's own footprint", (t) => {
  // mapbox anchors with translate(-50%, -100%), so the root's box is what
  // decides where the pin's tip lands.
  const el = makePin({ size: 26 });
  t.is(el.style.width, "26px");
  t.is(el.style.height, "32.5px");
});

test("gives the label a positioned ancestor of its own", (t) => {
  const el = makePin();
  const inner = el.firstElementChild;
  t.is(inner.style.position, "relative");
  t.is(inner.style.width, "100%");
  t.is(inner.style.height, "100%");
});

test("keeps the label out of the root's layout size", (t) => {
  const el = makePin();
  const tag = el.querySelector("div[style*='ellipsis']");
  t.is(tag.style.position, "absolute");
});

test("renders the label as text, never as markup", (t) => {
  const el = makePin({ label: "<img src=x onerror=alert(1)>" });
  t.is(el.querySelectorAll("img").length, 0);
  t.true(el.textContent.includes("<img"));
});

test("exposes the label as the accessible name", (t) => {
  t.is(makePin({ label: "Oak Hill Neighbors" }).getAttribute("aria-label"), "Oak Hill Neighbors");
});

test("keeps the pin artwork's aspect ratio undistorted", (t) => {
  // The SVG viewBox is 32x40 (0.8); the root must match or the tip shifts.
  const el = makePin({ size: 32 });
  t.is(Number.parseFloat(el.style.width) / Number.parseFloat(el.style.height), 32 / 40);
});

// ── Saved viewport ──────────────────────────────────────────────────────

test.serial("remembers and restores a viewport", (t) => {
  saveMapView({ lat: 38.48, lng: -122.75, zoom: 15.5 });
  t.deepEqual(loadMapView(), { lat: 38.48, lng: -122.75, zoom: 15.5 });
});

test.serial("returns null rather than feeding mapbox a nonsense viewport", (t) => {
  // A non-finite center makes mapbox throw on construction, so a corrupt or
  // hand-edited entry has to be treated as "no saved view" instead.
  for (const bad of [
    '{"lat":null,"lng":-122,"zoom":12}',
    '{"lat":38,"lng":-122}',
    '{"lat":91,"lng":-122,"zoom":12}',
    '{"lat":38,"lng":-181,"zoom":12}',
    "not json at all",
  ]) {
    window.sessionStorage.setItem("toolber:mapView", bad);
    t.is(loadMapView(), null, bad);
  }
});

test.serial("has no saved viewport before anything is stored", (t) => {
  window.sessionStorage.removeItem("toolber:mapView");
  t.is(loadMapView(), null);
});

test("keeps tool pins above group pins", (t) => {
  // A group pin is bigger and would otherwise cover the chest pins fanned out
  // around its own coordinate.
  t.true(pinZIndex("tool") > pinZIndex("group"));
});

// ── Popup construction ──────────────────────────────────────────────────

test("renders a tool popup with its title, subtitle and thumbnail", (t) => {
  const el = toolPopupElement({
    name: "Wet tile saw",
    subtitle: "Ridgid · Good",
    thumbUrl: "https://example.test/t.thumb.jpg",
    fullUrl: "https://example.test/t.jpg",
  });

  t.is(el.querySelector("b").textContent, "Wet tile saw");
  t.true(el.textContent.includes("Ridgid · Good"));
  // The small file is what actually loads; the full one is only a fallback.
  t.is(el.querySelector("img").getAttribute("src"), "https://example.test/t.thumb.jpg");
});

test("falls back to the full image when a thumbnail 404s", (t) => {
  // Photos uploaded before thumbnails existed have no .thumb.jpg sibling.
  // An inline onerror attribute would be blocked by the app's CSP, which is
  // why this is a real listener on a built node.
  const el = toolPopupElement({
    name: "Old ladder",
    thumbUrl: "https://example.test/missing.thumb.jpg",
    fullUrl: "https://example.test/full.jpg",
  });
  const img = el.querySelector("img");

  img.dispatchEvent(new window.Event("error"));
  t.is(img.getAttribute("src"), "https://example.test/full.jpg");
});

test("does not loop when the fallback image fails too", (t) => {
  const el = toolPopupElement({
    name: "Old ladder",
    thumbUrl: "https://example.test/missing.thumb.jpg",
    fullUrl: "https://example.test/full.jpg",
  });
  const img = el.querySelector("img");

  img.dispatchEvent(new window.Event("error"));
  img.dispatchEvent(new window.Event("error"));
  t.is(img.getAttribute("src"), "https://example.test/full.jpg");
});

test("renders a photoless tool popup without an empty image slot", (t) => {
  const el = toolPopupElement({ name: "Hand plane" });
  t.is(el.querySelector("img"), null);
  t.is(el.textContent, "Hand plane");
});

test("treats popup text as text, never as markup", (t) => {
  // Popups are built from DOM nodes now, so a tool named like a tag is inert
  // by construction rather than by remembering to escape it.
  const el = toolPopupElement({ name: '<img src=x onerror="alert(1)">' });
  t.is(el.querySelector("b").textContent, '<img src=x onerror="alert(1)">');
  t.is(el.querySelectorAll("img").length, 0);
});

test("labels a group popup as a group", (t) => {
  const el = groupPopupElement("Oak Hill");
  t.is(el.querySelector("b").textContent, "Oak Hill");
  t.true(el.textContent.includes("Group"));
});

test("keeps popups above every pin", (t) => {
  // Markers and popups are siblings in mapbox's container and popups have no
  // z-index of their own, so giving pins one buried the popups behind them.
  // If pinZIndex ever grows past this, popups start rendering behind pins
  // again — the CSS rule in index.css is keyed to POPUP_Z_INDEX.
  t.true(POPUP_Z_INDEX > pinZIndex("tool"));
  t.true(POPUP_Z_INDEX > pinZIndex("group"));
});


test("the device dot is round and blue, not a pin", (t) => {
  // A pin marks a thing that is there; this marks the person looking. Blue and
  // round is what every map uses for it, so it needs no explaining.
  const el = deviceDotElement();

  t.is(el.getAttribute("aria-label"), "Your location");
  const dot = [...el.querySelectorAll("div")].find((d) => d.style.backgroundColor === "rgb(40, 120, 184)");
  t.truthy(dot, "expected a solid blue centre");
  t.is(dot.style.borderRadius, "50%");
});

test("the device dot carries an accuracy halo", (t) => {
  const el = deviceDotElement();
  const halo = [...el.querySelectorAll("div")].find((d) => d.style.backgroundColor.startsWith("rgba"));
  t.truthy(halo, "expected a translucent ring around the dot");
});

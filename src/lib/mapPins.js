// Pure helpers behind the map. Split out of ToolMap.jsx so they can be tested:
// that module reads import.meta.env and imports mapbox-gl at module scope, so
// it cannot be loaded outside Vite at all (docs/audit-2026-08-20.md, FE-12).

/**
 * Build the DOM element for a map pin.
 *
 * The root element must NOT carry an inline `position`. mapbox-gl positions
 * markers with a stylesheet rule — `.mapboxgl-marker { position: absolute }` —
 * and an inline style beats a stylesheet, so setting `position: relative` here
 * silently dropped every marker back into normal flow. Each one then picked up
 * its static flow offset on top of mapbox's `translate()`, i.e. a constant
 * screen-space offset. A constant *screen* offset is a *varying* ground offset,
 * so the pins slid across the basemap as you zoomed while keeping their spacing
 * — see docs/audit-2026-08-20.md (BUG-1).
 *
 * The label needs a positioned ancestor, so an inner wrapper provides one
 * instead. That also means this does not depend on mapbox's CSS having loaded.
 *
 * @param {object} opts
 * @param {number} opts.size       pin width in px (height is 1.25x)
 * @param {string} opts.color      pin fill
 * @param {string} opts.iconPaths  raw SVG markup for the badge glyph
 * @param {string} opts.label      accessible name, also drawn as the map label
 */
export function pinElement({ size, color, iconPaths, label }) {
  // The root's box is exactly the pin's own footprint: mapbox anchors it with
  // `translate(-50%, -100%)`, so anything that changed this element's size
  // would move where the pin's tip lands.
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size * 1.25}px`;
  el.style.cursor = "pointer";
  el.setAttribute("aria-label", label);

  const inner = document.createElement("div");
  inner.style.position = "relative";
  inner.style.width = "100%";
  inner.style.height = "100%";
  el.appendChild(inner);

  const pin = document.createElement("div");
  pin.style.width = "100%";
  pin.style.height = "100%";
  pin.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,.4))";
  pin.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 32 40" width="100%" height="100%">
      <path d="M16 1C7.7 1 1 7.6 1 15.8c0 7.6 12 21.7 14.2 24.1.5.5 1.3.5 1.8 0C19.1 37.5 31 23.4 31 15.8 31 7.6 24.3 1 16 1z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="16" cy="15.5" r="9.5" fill="#fff"/>
      ${iconPaths}
    </svg>
  `;
  inner.appendChild(pin);

  // Name label — like Google Maps' place labels, so pins are identifiable
  // without relying on colour/icon alone. Absolutely positioned so it never
  // contributes to the root's layout size.
  const tag = document.createElement("div");
  tag.textContent = label;
  tag.style.position = "absolute";
  tag.style.left = "50%";
  tag.style.bottom = `${size * 0.15}px`;
  tag.style.transform = "translateX(6px)";
  tag.style.maxWidth = "130px";
  tag.style.overflow = "hidden";
  tag.style.textOverflow = "ellipsis";
  tag.style.whiteSpace = "nowrap";
  tag.style.background = "rgba(22,24,27,.85)";
  tag.style.color = "#fff";
  tag.style.font = "600 10.5px 'IBM Plex Sans', sans-serif";
  tag.style.padding = "1.5px 6px";
  tag.style.borderRadius = "4px";
  inner.appendChild(tag);

  return el;
}

/** Escape a string for interpolation into a popup's innerHTML. */
export function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Which tools and groups can actually be plotted.
 *
 * Pins come from each chest's / group's own persisted approx_lat/lng — never
 * recomputed here. Re-jittering on read would let repeated samples be averaged
 * back to the real location (see docs/technical-design.md -> Location & Privacy
 * Model). A chest with map_pin_hidden gets no pin at all.
 */
export function plottablePoints(tools = [], groups = []) {
  const toolPoints = tools
    .filter(
      (t) =>
        t.profiles?.approx_lat != null &&
        t.profiles?.approx_lng != null &&
        !t.profiles?.map_pin_hidden
    )
    .map((t) => ({ type: "tool", lat: t.profiles.approx_lat, lng: t.profiles.approx_lng, data: t }));

  const groupPoints = groups
    .filter((g) => g.approx_lat != null && g.approx_lng != null)
    .map((g) => ({ type: "group", lat: g.approx_lat, lng: g.approx_lng, data: g }));

  return [...toolPoints, ...groupPoints];
}

/**
 * Group points that share a coordinate, so co-located pins can be fanned out
 * instead of stacking invisibly. A group's pin currently defaults to its
 * creator's own chest point, which makes exact collisions common.
 *
 * Keyed to 4 decimal places (~11 m) — close enough that the pins would overlap.
 */
export function clusterByCoordinate(points) {
  const buckets = new Map();
  for (const p of points) {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  return [...buckets.values()];
}

/** How far apart to nudge pins that share a coordinate. */
export const FAN_OUT_METERS = 30;

/** Stable, order-independent 32-bit hash of an id. */
function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Displacement for a pin that shares its coordinate with another pin, as a
 * lat/lng delta — **not** a pixel offset.
 *
 * This used to return a constant 16px offset passed to `Marker#offset`, which
 * looked right but meant the pin's real-world position changed with the zoom
 * level: 16px is ~240 m at zoom 13 and ~30 m at zoom 16, so a co-located pair
 * visibly slid across the basemap as you zoomed. A geographic delta keeps every
 * pin fixed to a real location at every zoom; pins simply overlap again when
 * you zoom far enough out, which is honest.
 *
 * The angle comes from a hash of the entity's own id, so it is stable across
 * reloads and independent of query order or of what else is in the cluster —
 * this is a fixed display offset, not a re-jitter of the stored point (which
 * CLAUDE.md forbids, since repeated re-jittering could be averaged back to the
 * real location). 30 m is far inside the ~800 m jitter radius the pin already
 * carries, so it reveals nothing.
 *
 * @returns {{dLat: number, dLng: number}} zero for a pin with no neighbours
 */
export function fanOutDelta(id, clusterSize, lat, meters = FAN_OUT_METERS) {
  if (clusterSize <= 1) return { dLat: 0, dLng: 0 };
  const angle = (hashId(id) % 360) * (Math.PI / 180);
  const dLat = (meters * Math.sin(angle)) / 111320;
  // Longitude degrees shrink towards the poles; clamp so a near-polar pin
  // cannot divide by ~0.
  const lngScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = (meters * Math.cos(angle)) / (111320 * lngScale);
  return { dLat, dLng };
}

/** True when this point is the one a "View on map" link asked to focus. */
export function isFocused(focus, point) {
  if (!focus) return false;
  return focus.type === point.type && String(focus.id) === String(point.data.id);
}

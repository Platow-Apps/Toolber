import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Crib pins: plain orange (attention), toolbox badge, standard size. Group
// pins: blue (racing), people badge, slightly larger. See
// docs/technical-design.md -> Location & Privacy Model and -> Core Flows ->
// Search. Pins are plotted at each crib/group's own persisted approx_lat/lng
// — never re-jittered here, never the real pickup_location. A crib with
// map_pin_hidden gets no pin (still shows in the list view elsewhere).

// Same toolbox glyph used on tool cards elsewhere in the app (Search, My
// Tools, Group Detail).
const TOOL_ICON = `<g transform="translate(8.2,8.7) scale(0.65)" stroke="#F2790B" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="9" width="18" height="8" rx="1"/>
  <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>
</g>`;

// Same people glyph used for the Groups tab in the bottom nav.
const GROUP_ICON = `<g transform="translate(8.8,8) scale(0.6)" stroke="#2878B8" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="9" cy="8" r="3"/>
  <circle cx="17" cy="9" r="2.4"/>
  <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/>
  <path d="M16 14.2a4 4 0 0 1 4.5 4"/>
</g>`;

function pinElement({ size, color, iconPaths, label }) {
  // Outer box is exactly the pin's own footprint — Mapbox reads this
  // element's offsetWidth/offsetHeight to compute the anchor="bottom"
  // math, so the label below (absolutely positioned, doesn't contribute to
  // layout size) can't be allowed to shift where the pin's tip lands.
  const el = document.createElement("div");
  el.style.position = "relative";
  el.style.width = `${size}px`;
  el.style.height = `${size * 1.25}px`;
  el.style.cursor = "pointer";
  el.setAttribute("aria-label", label);

  const pin = document.createElement("div");
  pin.style.width = "100%";
  pin.style.height = "100%";
  pin.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,.4))";
  pin.innerHTML = `
    <svg viewBox="0 0 32 40" width="100%" height="100%">
      <path d="M16 1C7.7 1 1 7.6 1 15.8c0 7.6 12 21.7 14.2 24.1.5.5 1.3.5 1.8 0C19.1 37.5 31 23.4 31 15.8 31 7.6 24.3 1 16 1z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="16" cy="15.5" r="9.5" fill="#fff"/>
      ${iconPaths}
    </svg>
  `;
  el.appendChild(pin);

  // Name label — like Google Maps' place labels, so pins are identifiable
  // without relying on color/icon alone.
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
  el.appendChild(tag);

  return el;
}

export default function ToolMap({ tools, groups, focus }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-98.5795, 39.8283], // continental US fallback; fitBounds below takes over once there are pins
      zoom: 3,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const pinnableTools = tools.filter(
      (t) => t.profiles?.approx_lat != null && t.profiles?.approx_lng != null && !t.profiles?.map_pin_hidden
    );
    const pinnableGroups = groups.filter((g) => g.approx_lat != null && g.approx_lng != null);

    const points = [
      ...pinnableTools.map((t) => ({ type: "tool", lat: t.profiles.approx_lat, lng: t.profiles.approx_lng, data: t })),
      ...pinnableGroups.map((g) => ({ type: "group", lat: g.approx_lat, lng: g.approx_lng, data: g })),
    ];

    // Co-located pins (e.g. a group's location currently defaults to its
    // creator's own crib location — see CreateGroup.jsx) would otherwise
    // render one directly on top of the other, hiding whichever is smaller
    // or added first. Fan them out with a small pixel-space offset — purely
    // a rendering nudge, the stored coordinate itself never changes.
    const buckets = new Map();
    points.forEach((p) => {
      const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    });

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    let focusMarker = null;

    buckets.forEach((cluster) => {
      cluster.forEach((p, i) => {
        let offset = [0, 0];
        if (cluster.length > 1) {
          const angle = (2 * Math.PI * i) / cluster.length - Math.PI / 2;
          offset = [Math.round(Math.cos(angle) * 16), Math.round(Math.sin(angle) * 16)];
        }

        const isTool = p.type === "tool";
        // A pin represents a crib (person) or a group, not a single tool —
        // one crib can have several tools stacked at the same point — so
        // the on-map label is the owner's handle / the group's name, not
        // the individual tool name (that's what the popup/click-through is
        // for).
        const el = pinElement({
          size: isTool ? 26 : 32,
          color: isTool ? "#F2790B" : "#2878B8",
          iconPaths: isTool ? TOOL_ICON : GROUP_ICON,
          label: isTool ? p.data.profiles?.display_name ?? "Unknown" : p.data.name,
        });
        el.addEventListener("click", () => navigate(isTool ? `/tool/${p.data.id}` : `/groups/${p.data.id}`));

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom", offset })
          .setLngLat([p.lng, p.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: isTool ? 26 : 32, closeButton: false }).setHTML(
              isTool
                ? `<div style="font-family:sans-serif;font-size:12px;line-height:1.4"><b>${escapeHtml(p.data.name)}</b><br/>${escapeHtml(p.data.profiles?.display_name ?? "Unknown")}</div>`
                : `<div style="font-family:sans-serif;font-size:12px;line-height:1.4"><b>${escapeHtml(p.data.name)}</b><br/>Group</div>`
            )
          )
          .addTo(map);

        markersRef.current.push(marker);
        bounds.extend([p.lng, p.lat]);
        hasPoints = true;

        if (focus && focus.type === p.type && String(focus.id) === String(p.data.id)) {
          focusMarker = marker;
        }
      });
    });

    // A "View on map" link (from Tool Detail / Group Detail) wants this one
    // specific pin front and center, not the usual fit-everything-in-view.
    if (focusMarker) {
      map.flyTo({ center: focusMarker.getLngLat(), zoom: 14, duration: 0 });
      focusMarker.togglePopup();
    } else if (hasPoints) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
    }
  }, [tools, groups, navigate, focus]);

  if (!mapboxgl.accessToken) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        Map view needs a Mapbox token (VITE_MAPBOX_TOKEN) — not configured yet.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

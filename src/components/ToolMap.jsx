import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  clusterByCoordinate,
  escapeHtml,
  fanOutDelta,
  isFocused,
  pinElement,
  plottablePoints,
} from "../lib/mapPins";
import { toolPhotoUrl } from "../lib/photos";

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

    // The container is no longer a fixed 60vh — it fills whatever the app shell
    // leaves over, which changes when a mobile browser's toolbars collapse or
    // the device rotates. Mapbox only measures its container on construction,
    // so without this the canvas keeps the stale size and the projection (and
    // therefore every pin) drifts out of alignment with the basemap.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => {
      m.remove();
    });
    markersRef.current = [];

    // Co-located pins (a group's location currently defaults to its creator's
    // own crib location — see CreateGroup.jsx, audit LOGIC-8) would otherwise
    // render one directly on top of the other, hiding whichever is smaller or
    // added first. Fan them out by a fixed ~30 m on the ground; the stored
    // coordinate itself never changes.
    const clusters = clusterByCoordinate(plottablePoints(tools, groups));

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    /** @type {mapboxgl.Marker | null} */
    let focusMarker = null;

    clusters.forEach((cluster) => {
      cluster.forEach((p) => {
        // Displace co-located pins geographically, not in screen pixels — a
        // pixel offset would make the pin's real position depend on the zoom.
        const { dLat, dLng } = fanOutDelta(p.data.id, cluster.length, p.lat);
        const lat = p.lat + dLat;
        const lng = p.lng + dLng;

        const isTool = p.type === "tool";
        // Each tool gets its own point (see plottablePoints), fanned out from
        // any neighbours at the same crib coordinate, so the label can safely
        // be that one tool's own title — no owner name needed to disambiguate
        // it. Keeping the owner's identity off the always-visible label (and
        // out of the popup below, until a borrower actually clicks through to
        // the tool page) is a deliberate privacy choice, not just cosmetic.
        const el = pinElement({
          size: isTool ? 26 : 32,
          color: isTool ? "#F2790B" : "#2878B8",
          iconPaths: isTool ? TOOL_ICON : GROUP_ICON,
          label: p.data.name,
        });
        el.addEventListener("click", () => navigate(isTool ? `/tool/${p.data.id}` : `/groups/${p.data.id}`));

        const photoUrl = isTool && p.data.photos?.[0] ? toolPhotoUrl(p.data.photos[0]) : null;

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([lng, lat])
          .setPopup(
            new mapboxgl.Popup({ offset: isTool ? 26 : 32, closeButton: false }).setHTML(
              isTool
                ? `<div style="font-family:sans-serif;font-size:12px;line-height:1.4;display:flex;gap:8px;align-items:flex-start;max-width:190px">
                    ${
                      photoUrl
                        ? `<img src="${escapeHtml(photoUrl)}" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0" />`
                        : ""
                    }
                    <div>
                      <b>${escapeHtml(p.data.name)}</b>
                      ${
                        p.data.description
                          ? `<div style="color:#555;margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escapeHtml(p.data.description)}</div>`
                          : ""
                      }
                    </div>
                  </div>`
                : `<div style="font-family:sans-serif;font-size:12px;line-height:1.4"><b>${escapeHtml(p.data.name)}</b><br/>Group</div>`
            )
          )
          .addTo(map);

        markersRef.current.push(marker);
        bounds.extend([lng, lat]);
        hasPoints = true;

        if (isFocused(focus, p)) {
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

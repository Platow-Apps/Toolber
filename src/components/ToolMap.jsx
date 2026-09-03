import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  clusterByCoordinate,
  fanOutDelta,
  groupPopupElement,
  isFocused,
  loadMapView,
  pinElement,
  pinZIndex,
  plottablePoints,
  POPUP_CLASS,
  saveMapView,
  toolPopupElement,
} from "../lib/mapPins";
import { toolPhotoUrl, toolThumbUrl } from "../lib/photos";
import { categoryColor } from "../lib/categoryColors";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Tool pins are coloured by category family (see lib/categoryColors.js), so a
// glance at the map says what kind of thing is around before anyone types a
// filter. Group pins stay blue with a people badge, slightly larger. See
// docs/technical-design.md -> Location & Privacy Model and -> Core Flows ->
// Search. Pins are plotted at each chest/group's own persisted approx_lat/lng
// — never re-jittered here, never the real pickup_location. A chest with
// map_pin_hidden gets no pin (still shows in the list view elsewhere).

const CONDITION_LABEL = { new: "New", good: "Good", fair: "Fair" };

// Same toolbox glyph used on tool cards elsewhere in the app (Search, My
// Tools, Group Detail).
const toolIcon = (color) => `<g transform="translate(8.2,8.7) scale(0.65)" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
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

export default function ToolMap({ tools, groups, focus, origin = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  // True once the viewport is the visitor's own — restored or auto-fitted —
  // and must not be recomputed under them.
  const restoredViewRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapboxgl.accessToken) return;

    // Restored before construction so the map never paints at the default
    // zoom first and then jumps.
    const saved = loadMapView();
    restoredViewRef.current = Boolean(saved);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: saved ? [saved.lng, saved.lat] : [-98.5795, 39.8283], // continental US fallback; fitBounds below takes over once there are pins
      zoom: saved ? saved.zoom : 3,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    // 'moveend' covers pan, zoom, and flyTo alike.
    const rememberView = () => {
      const c = map.getCenter();
      saveMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on("moveend", rememberView);

    // The container is no longer a fixed 60vh — it fills whatever the app shell
    // leaves over, which changes when a mobile browser's toolbars collapse or
    // the device rotates. Mapbox only measures its container on construction,
    // so without this the canvas keeps the stale size and the projection (and
    // therefore every pin) drifts out of alignment with the basemap.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.off("moveend", rememberView);
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
    // own chest location — see CreateGroup.jsx, audit LOGIC-8) would otherwise
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
        // any neighbours at the same chest coordinate, so the label can safely
        // be that one tool's own title — no owner name needed to disambiguate
        // it. Keeping the owner's identity off the always-visible label (and
        // out of the popup below, until a borrower actually clicks through to
        // the tool page) is a deliberate privacy choice, not just cosmetic.
        const el = pinElement({
          size: isTool ? 26 : 32,
          color: isTool ? categoryColor(p.data.category) : "#2878B8",
          iconPaths: isTool ? toolIcon(categoryColor(p.data.category)) : GROUP_ICON,
          label: p.data.name,
        });
        // Tool pins sit above group pins so a cluster fanned out around a
        // group's own point stays pickable.
        el.style.zIndex = String(pinZIndex(p.type));
        el.addEventListener("click", () => navigate(isTool ? `/tool/${p.data.id}` : `/groups/${p.data.id}`));

        const photoPath = isTool ? (p.data.photos?.[0] ?? null) : null;
        // Brand and condition say more in a one-line preview than the opening
        // words of a paragraph did. Pre-0026 listings still fall back to their
        // free-text description.
        const subtitle = isTool
          ? [p.data.brand, CONDITION_LABEL[p.data.condition], p.data.subcategory]
              .filter(Boolean)
              .join(" · ") || p.data.description
          : null;

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([lng, lat])
          .setPopup(
            new mapboxgl.Popup({ offset: isTool ? 26 : 32, closeButton: false, className: POPUP_CLASS }).setDOMContent(
              isTool
                ? toolPopupElement({
                    name: p.data.name,
                    subtitle,
                    thumbUrl: photoPath ? toolThumbUrl(photoPath) : null,
                    fullUrl: photoPath ? toolPhotoUrl(photoPath) : null,
                  })
                : groupPopupElement(p.data.name)
            )
          )
          .addTo(map);

        // Clicking navigates, so without this the popup was effectively
        // unreachable except through a "View on map" deep link. Touch devices
        // have no hover and go straight to the tool page, which is fine.
        el.addEventListener("mouseenter", () => {
          if (!marker.getPopup().isOpen()) marker.togglePopup();
        });
        el.addEventListener("mouseleave", () => {
          if (marker.getPopup().isOpen()) marker.togglePopup();
        });

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
    } else if (hasPoints && !restoredViewRef.current) {
      // Only frame everything on a genuinely fresh map. Re-fitting after a
      // restore -- or on every keystroke as search results change -- is what
      // used to throw away the visitor's own zoom.
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      restoredViewRef.current = true;
    }
  }, [tools, groups, navigate, focus]);

  function recenter() {
    const map = mapRef.current;
    if (!map || !origin) return;
    // Keeps whatever zoom the person is on rather than snapping to a fixed
    // one -- they may have deliberately zoomed out to see the whole county.
    map.flyTo({ center: [origin.lng, origin.lat], duration: 600 });
  }

  if (!mapboxgl.accessToken) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        Map view needs a Mapbox token (VITE_MAPBOX_TOKEN) — not configured yet.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Panning away and not being able to get back is the map's easiest
          frustration to fix. Only offered when there is somewhere to go: the
          search origin, which defaults to the person's own area. */}
      {origin && (
        <button
          type="button"
          onClick={recenter}
          aria-label={`Re-center the map on ${origin.label ?? "your area"}`}
          className="absolute right-2.5 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-cardBorder bg-white shadow-md"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#16181B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="3.5" />
            <line x1="12" y1="1.5" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22.5" y2="12" />
          </svg>
        </button>
      )}
    </div>
  );
}

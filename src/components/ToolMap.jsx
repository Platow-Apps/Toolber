import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Crib pins: red-orange (signal), standard size. Group pins: blue (racing),
// slightly larger. See docs/technical-design.md -> Location & Privacy Model
// and -> Core Flows -> Search. Pins are plotted at each crib/group's own
// persisted approx_lat/lng — never re-jittered here, never the real
// pickup_location. A crib with map_pin_hidden gets no pin (still shows in
// the list view elsewhere).
function pinElement({ size, color }) {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50% 50% 50% 0";
  el.style.transform = "rotate(-45deg)";
  el.style.background = color;
  el.style.border = "2px solid #fff";
  el.style.boxShadow = "0 1px 3px rgba(0,0,0,.35)";
  el.style.cursor = "pointer";
  return el;
}

export default function ToolMap({ tools, groups }) {
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

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;

    const pinnableTools = tools.filter(
      (t) => t.profiles?.approx_lat != null && t.profiles?.approx_lng != null && !t.profiles?.map_pin_hidden
    );

    pinnableTools.forEach((tool) => {
      const el = pinElement({ size: 18, color: "#E1382D" });
      el.setAttribute("aria-label", tool.name);
      el.addEventListener("click", () => navigate(`/tool/${tool.id}`));
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([tool.profiles.approx_lng, tool.profiles.approx_lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 20, closeButton: false }).setHTML(
            `<div style="font-family:sans-serif;font-size:12px;line-height:1.4"><b>${escapeHtml(tool.name)}</b><br/>${escapeHtml(tool.profiles?.display_name ?? "Unknown")}</div>`
          )
        )
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([tool.profiles.approx_lng, tool.profiles.approx_lat]);
      hasPoints = true;
    });

    groups.forEach((g) => {
      if (g.approx_lat == null || g.approx_lng == null) return;
      const el = pinElement({ size: 24, color: "#2878B8" });
      el.setAttribute("aria-label", g.name);
      el.addEventListener("click", () => navigate(`/groups/${g.id}`));
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([g.approx_lng, g.approx_lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 26, closeButton: false }).setHTML(
            `<div style="font-family:sans-serif;font-size:12px;line-height:1.4"><b>${escapeHtml(g.name)}</b><br/>Group</div>`
          )
        )
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([g.approx_lng, g.approx_lat]);
      hasPoints = true;
    });

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
    }
  }, [tools, groups, navigate]);

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

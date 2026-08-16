import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const DEFAULT_RADIUS_METERS = 800; // ~0.5 mi — changeable later in Settings → Privacy & Location

// Uniformly-distributed random point within `radiusMeters` of (lat, lng).
// √(random) scaling avoids bunching points near the center — see
// docs/technical-design.md → Location & Privacy Model.
function jitterPoint(lat, lng, radiusMeters) {
  const radiusDeg = radiusMeters / 111320;
  const u = Math.random();
  const v = Math.random();
  const w = radiusDeg * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dLng = (w * Math.cos(t)) / Math.cos((lat * Math.PI) / 180);
  const dLat = w * Math.sin(t);
  return { lat: lat + dLat, lng: lng + dLng };
}

export default function Onboarding() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [locationChoice, setLocationChoice] = useState(null); // "auto" | "hidden"
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = displayName.trim() && tosAccepted && locationChoice;

  async function handleSubmit() {
    setError("");
    setSaving(true);

    let updates = {
      display_name: displayName.trim(),
      tos_accepted_at: new Date().toISOString(),
      tos_version: "v0-placeholder", // real ToS not drafted yet — see docs Open Questions
      profile_complete: true,
    };

    if (locationChoice === "hidden") {
      updates = { ...updates, map_pin_hidden: true };
    } else {
      // "auto": try browser geolocation for a one-time home point, then jitter+persist.
      // No Mapbox road-snap yet (token not configured) — the privacy-critical part
      // (once-only generation, √-scaled jitter) is still correct; snapping is cosmetic.
      const position = await new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          () => resolve(null),
          { timeout: 8000 }
        );
      });

      if (!position) {
        setSaving(false);
        setError("Couldn't get your location — allow location access, or choose \"Hide my tools' location\" instead.");
        return;
      }

      const jittered = jitterPoint(position.latitude, position.longitude, DEFAULT_RADIUS_METERS);
      updates = {
        ...updates,
        home_lat: position.latitude,
        home_lng: position.longitude,
        approx_lat: jittered.lat,
        approx_lng: jittered.lng,
        pin_radius_meters: DEFAULT_RADIUS_METERS,
        pin_placement_mode: "auto_jitter",
        map_pin_hidden: false,
      };
    }

    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    await refreshProfile();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-page px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
          Set up your account
        </h1>
        <p className="mb-6 text-sm text-ink">A couple of things before you can search or list tools.</p>

        <div className="mb-5">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Jordan K."
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted">
            How should your tools' location appear on the map?
          </p>
          <button
            type="button"
            onClick={() => setLocationChoice("auto")}
            className={`mb-2 w-full rounded-lg border p-3 text-left text-sm ${
              locationChoice === "auto" ? "border-asphalt bg-asphalt text-safety" : "border-cardBorder bg-white text-asphalt"
            }`}
          >
            <span className="block font-semibold">Random Pin (recommended)</span>
            <span className="block text-xs opacity-80">Approximate, generated once from your location — never your exact address</span>
          </button>
          <button
            type="button"
            onClick={() => setLocationChoice("hidden")}
            className={`w-full rounded-lg border p-3 text-left text-sm ${
              locationChoice === "hidden" ? "border-asphalt bg-asphalt text-safety" : "border-cardBorder bg-white text-asphalt"
            }`}
          >
            <span className="block font-semibold">Hide my tools' location</span>
            <span className="block text-xs opacity-80">Your tools stay findable via search, just no map pin</span>
          </button>
        </div>

        <label className="mb-6 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={tosAccepted} onChange={(e) => setTosAccepted(e.target.checked)} className="mt-0.5" />
          <span>I agree to the Terms of Service and Privacy Policy, and understand borrowing/lending tools carries inherent risk.</span>
        </label>

        {error && <p className="mb-4 text-sm text-signal">{error}</p>}

        <button
          type="button"
          disabled={!canSubmit || saving}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-40"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

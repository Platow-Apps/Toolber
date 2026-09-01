import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { TERMS_VERSION } from "./Terms";
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

// Forward-geocodes a typed address via Mapbox. Every member needs a real
// home point on file (for their own jittered map pin, and for proximity
// sorting in Find a Group) — geolocation used to be the only path here, but
// a browser permission denial or an unsupported device left no fallback.
// A typed address always works, and Mapbox is already the app's map
// provider, so no new service is introduced.
async function geocodeAddress(address) {
  // Optional chaining: import.meta.env is a Vite-only feature and is simply
  // undefined under the AVA/tsx test runner (see src/lib/mapPins.js's header
  // comment — Will already hit this exact issue with ToolMap.jsx). A missing
  // or bad token still fails gracefully below via the same !res.ok /
  // !feature checks a real misconfiguration would hit, so no separate guard
  // is needed here.
  const token = import.meta.env?.VITE_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't reach the address lookup service. Try again.");

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error("Couldn't find that address — try adding city and state.");

  const [lng, lat] = feature.center;
  return { lat, lng };
}

export default function Onboarding() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [street1, setStreet1] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [zip, setZip] = useState("");

  // One line for the geocoder. Unit numbers are dropped deliberately: they
  // never help place a point and often confuse the lookup.
  const address = [street1, city, stateRegion, zip].map((p) => p.trim()).filter(Boolean).join(", ");
  const [showOnMap, setShowOnMap] = useState(true);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // City and state are what the geocoder actually needs to disambiguate a
  // street name; a bare street line is the usual cause of "couldn't find
  // that address".
  const canSubmit =
    displayName.trim() && street1.trim() && city.trim() && stateRegion.trim() && tosAccepted;

  async function handleSubmit() {
    setError("");
    setSaving(true);

    let home;
    try {
      home = await geocodeAddress(address);
    } catch (err) {
      setSaving(false);
      setError(err.message);
      return;
    }

    const jittered = jitterPoint(home.lat, home.lng, DEFAULT_RADIUS_METERS);
    const updates = {
      display_name: displayName.trim(),
      tos_accepted_at: new Date().toISOString(),
      // Whatever version of the terms the user actually accepted. Bump
      // TERMS_VERSION in Terms.jsx whenever the text changes materially, and
      // existing rows will correctly show they accepted the older version.
      tos_version: TERMS_VERSION,
      profile_complete: true,
      home_lat: home.lat,
      home_lng: home.lng,
      approx_lat: jittered.lat,
      approx_lng: jittered.lng,
      pin_radius_meters: DEFAULT_RADIUS_METERS,
      pin_placement_mode: "auto_jitter",
      map_pin_hidden: !showOnMap,
    };

    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Whether people keep their pin visible is the single most interesting
    // privacy metric in the product, so it's recorded alongside completion.
    await logEvent(user.id, EVENTS.ONBOARDING_COMPLETED, { map_pin_hidden: !showOnMap });

    await refreshProfile();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-app flex-col bg-page px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
          Set up your account
        </h1>
        <p className="mb-6 text-sm text-ink">A couple of things before you can search or list tools.</p>

        <div className="mb-5">
          <label htmlFor="onboarding-display-name" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Display name</label>
          <input
            id="onboarding-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Jordan K."
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        {/* Separate fields rather than one free-text line: a typed address
            that omits the city or state is the most common reason the
            geocoder can't place someone, and one box gave no hint that any
            of it was missing. */}
        <fieldset className="mb-5 border-0 p-0">
          <legend className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Your address
          </legend>

          <div className="space-y-1.5">
            <input
              id="onboarding-street1"
              aria-label="Street address"
              value={street1}
              onChange={(e) => setStreet1(e.target.value)}
              placeholder="Street address"
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <input
              id="onboarding-street2"
              aria-label="Apartment, suite, unit (optional)"
              value={street2}
              onChange={(e) => setStreet2(e.target.value)}
              placeholder="Apt, suite, unit (optional)"
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <div className="flex gap-1.5">
              <input
                id="onboarding-city"
                aria-label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                className="min-w-0 flex-1 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
              />
              <input
                id="onboarding-state"
                aria-label="State"
                value={stateRegion}
                onChange={(e) => setStateRegion(e.target.value)}
                placeholder="State"
                maxLength={20}
                className="w-20 flex-shrink-0 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
              />
              <input
                id="onboarding-zip"
                aria-label="ZIP code"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="ZIP"
                maxLength={10}
                className="w-24 flex-shrink-0 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
              />
            </div>
          </div>

          <p className="mt-1 text-[0.688rem] leading-relaxed text-muted">
            Every member needs this so nearby tools and groups can be found — your exact address is never shown to
            anyone. What appears on the map (if anything) is an approximate point, randomized once nearby.
          </p>
        </fieldset>

        <label className="mb-5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
          <span className="text-sm font-semibold text-asphalt">Show my approximate location on the map</span>
          <input
            type="checkbox"
            checked={showOnMap}
            onChange={(e) => setShowOnMap(e.target.checked)}
            aria-label="Show my approximate location on the map"
          />
        </label>
        {!showOnMap && (
          <p className="-mt-3 mb-5 text-[0.688rem] leading-relaxed text-muted">
            Your tools stay findable via search either way — this only controls the map pin.
          </p>
        )}

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

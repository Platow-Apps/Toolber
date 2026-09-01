import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { EVENTS, logEvent } from "../lib/analytics";
import { geocodeAddress, groupAreaQuery } from "../lib/geocode";
import PageHeader from "../components/PageHeader";

export default function CreateGroup() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [neighborhoodLabel, setNeighborhoodLabel] = useState("");
  const [city, setCity] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [exchangeLocation, setExchangeLocation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);

    // One RPC, one transaction: the group row and the creator's own
    // membership land together or not at all. Doing these as two client
    // inserts could leave a group with no members and its creator locked out
    // of it, with the invite code burnt (audit LOGIC-6). The invite code is
    // generated server-side now too, so its uniqueness retry happens inside
    // the same transaction that uses it (LOGIC-7).
    const { data: groupId, error } = await supabase.rpc("create_group", {
      p_name: name.trim(),
      p_neighborhood_label: neighborhoodLabel.trim() || null,
      p_city: city.trim() || null,
      p_zip_code: zipCode.trim() || null,
      p_default_exchange_location: exchangeLocation.trim() || null,
    });

    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    await logEvent(user.id, EVENTS.GROUP_CREATED, { group_id: groupId });

    // Put the group on the map straight away, from the area the admin just
    // typed rather than from where any member lives (0037). A group with one
    // member is the one most in need of being found, and this is the only
    // source of a pin that stays true at that size.
    //
    // Best-effort on purpose: the group exists and the admin is about to see
    // it. A geocoder that is down, or an area too vague to place, is a missing
    // pin they can set later — not a reason to fail the creation they already
    // completed.
    const area = groupAreaQuery({
      neighborhood_label: neighborhoodLabel,
      city,
      zip_code: zipCode,
    });
    if (area) {
      try {
        const { lat, lng } = await geocodeAddress(area);
        await supabase.rpc("set_group_pin", { p_group_id: groupId, p_lat: lat, p_lng: lng });
      } catch (err) {
        console.warn("Could not place the group on the map yet:", err);
      }
    }

    navigate(`/groups/${groupId}`, { replace: true });
  }

  return (
    <div className="pb-6">
      <PageHeader title="Create New Group" backTo="/groups" />

      <form onSubmit={handleSubmit} className="px-4 py-4">
        <div className="mb-3.5">
          <label htmlFor="group-name" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Group name</label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Oak Hill Neighbors"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <label htmlFor="group-neighborhood-optional" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Neighborhood <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <input
            id="group-neighborhood-optional"
            value={neighborhoodLabel}
            onChange={(e) => setNeighborhoodLabel(e.target.value)}
            placeholder="e.g. Oak Hill"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5 flex gap-2">
          <div className="flex-1">
            <label htmlFor="group-city-optional" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              City <span className="normal-case text-[#B0AEA6]">(optional)</span>
            </label>
            <input
            id="group-city-optional"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>
          <div className="w-28">
            <label htmlFor="group-zip-optional" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              Zip <span className="normal-case text-[#B0AEA6]">(optional)</span>
            </label>
            <input
            id="group-zip-optional"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
          </div>
        </div>

        <div className="mb-3.5">
          <label htmlFor="group-default-exchange-spot" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Default exchange spot <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <input
            id="group-default-exchange-spot"
            value={exchangeLocation}
            onChange={(e) => setExchangeLocation(e.target.value)}
            placeholder="e.g. Oak Hill Park, main entrance"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
          <p className="mt-1 text-[0.688rem] text-muted">
            A convenient default meeting spot for this group — unlike a tool's pickup location, this one's meant to be findable, not private. You can change it later.
          </p>
        </div>

        {/* This note used to say map placement wasn't wired up and that the
            pin defaulted to the creator's own location. Both stopped being
            true — the second was a privacy bug (audit LOGIC-8). */}
        <p className="mb-4 rounded-lg border border-dashed border-cardBorder bg-white p-2.5 text-xs leading-relaxed text-muted">
          The neighborhood, city and zip above place your group's pin on the map, so people nearby
          can find you from day one. It marks the <i>area</i>, never anyone's address — no member's
          location is used. You can move it later. An invite code is generated automatically.
        </p>

        {error && <p className="mb-3 text-sm text-signal">{error}</p>}

        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create Group"}
        </button>
      </form>
    </div>
  );
}

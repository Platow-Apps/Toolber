import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { EVENTS, logEvent } from "../lib/analytics";

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

    navigate(`/groups/${groupId}`, { replace: true });
  }

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2.5 bg-asphalt px-4 py-3.5">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="font-condensed text-base font-bold uppercase tracking-wide text-safety">Create New Group</p>
      </div>

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

        <p className="mb-4 rounded-lg border border-dashed border-cardBorder bg-white p-2.5 text-xs leading-relaxed text-muted">
          Map placement isn't wired up yet (needs Mapbox) — the group's map pin defaults to your own approximate location for now. An invite code is generated automatically.
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

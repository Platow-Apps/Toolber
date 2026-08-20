import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { generateInviteCode } from "../lib/inviteCode";
import { EVENTS, logEvent } from "../lib/analytics";

export default function CreateGroup() {
  const { user, profile } = useAuth();
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

    // invite_code is unique — collisions are rare (32^7 space) but retry a
    // couple times with a fresh code rather than surfacing the raw DB error.
    let group = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !group; attempt++) {
      const { data, error } = await supabase
        .from("groups")
        .insert({
          name: name.trim(),
          neighborhood_label: neighborhoodLabel.trim() || null,
          city: city.trim() || null,
          zip_code: zipCode.trim() || null,
          default_exchange_location: exchangeLocation.trim() || null,
          invite_code: generateInviteCode(),
          admin_id: user.id,
          approx_lat: profile?.approx_lat ?? null,
          approx_lng: profile?.approx_lng ?? null,
        })
        .select("id")
        .single();
      if (!error) {
        group = data;
      } else if (error.code === "23505") {
        lastError = error;
      } else {
        lastError = error;
        break;
      }
    }

    if (!group) {
      setSaving(false);
      setError(lastError?.message ?? "Couldn't create the group. Try again.");
      return;
    }

    // Creator is automatically an approved member of their own group.
    const { error: membershipErr } = await supabase.from("group_memberships").insert({
      group_id: group.id,
      profile_id: user.id,
      status: "approved",
      decided_at: new Date().toISOString(),
    });
    if (membershipErr) {
      setSaving(false);
      setError(`Group created, but couldn't add you as a member: ${membershipErr.message}`);
      return;
    }

    await logEvent(user.id, EVENTS.GROUP_CREATED, { group_id: group.id });

    navigate(`/groups/${group.id}`, { replace: true });
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

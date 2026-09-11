import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RADIUS_METERS, RADIUS_CHOICES, saveLocation } from "../lib/location";
import { supabase } from "../lib/supabaseClient";

/**
 * Named places — a cabin, a shop, a second home.
 *
 * A chest was one account with one point, so every tool plotted at the owner's
 * house no matter where it was actually kept. The handover already worked (a
 * tool's pickup address has been per-tool since 0001); what did not was
 * *discovery* — somebody searching near the cabin saw the cabin's chainsaw
 * forty miles away and sorted it last.
 *
 * Everything here goes through RPCs. `profile_locations` has no SELECT grant
 * for any role: it holds real coordinates and a street address, and keeping it
 * function-only means no future column list can quietly expose them.
 *
 * Deliberately not shown to people who have one place. It sits behind an
 * "Add another place" control so the overwhelming majority never meet it.
 */
export default function MyPlaces() {
  const [places, setPlaces] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS_METERS);
  const [pickup, setPickup] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("my_locations");
    setLoaded(true);
    if (err) return setError(err.message);
    setPlaces(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setLabel("");
    setAddress("");
    setRadius(DEFAULT_RADIUS_METERS);
    setPickup("");
    setEditingId(null);
    setOpen(false);
  }

  async function save() {
    if (!label.trim()) return setError("Give this place a name.");
    // Editing without retyping the address is the common case -- the label or
    // the pickup line is what changed. The server keeps the existing pin when
    // nothing about the position moved, and there is no way to send "same
    // address" without geocoding it again, so require it explicitly.
    if (!address.trim()) return setError("Enter the address for this place.");

    setSaving(true);
    const result = await saveLocation({
      label: label.trim(),
      address: address.trim(),
      radiusMeters: radius,
      pickupAddress: pickup.trim() || null,
      id: editingId,
    });
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setError("");
    reset();
    load();
  }

  async function remove(id, toolCount) {
    if (
      toolCount > 0 &&
      !window.confirm(
        `${toolCount} tool(s) are kept there. They will fall back to your main area. Remove it?`,
      )
    ) {
      return;
    }
    const { error: err } = await supabase.rpc("delete_my_location", { p_id: id });
    if (err) return setError(err.message);
    setError("");
    load();
  }

  if (!loaded) return null;

  return (
    <div
      className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
      style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
    >
      <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-asphalt">
        Add tool chest location
      </p>
      <p className="mb-2.5 text-[0.75rem] leading-relaxed text-muted">
        A cabin, a workshop, a second home. A tool kept at one of these shows on the map there instead of at
        your main area, so neighbors near it can actually find it.
      </p>

      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-[#FCEBEB] p-2 text-[0.75rem] leading-relaxed text-signal">{error}</p>
      )}

      {places.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {places.map((pl) => (
            <div
              key={pl.id}
              className="flex items-center justify-between gap-2 border-t border-cardBorder pt-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-asphalt">{pl.label}</p>
                <p className="font-mono text-[0.688rem] text-muted">
                  {pl.tool_count} tool{Number(pl.tool_count) === 1 ? "" : "s"}
                  {pl.pickup_address ? " · pickup address saved" : " · no pickup address"}
                </p>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(pl.id);
                    setLabel(pl.label);
                    setAddress("");
                    setRadius(Number(pl.pin_radius_meters) || DEFAULT_RADIUS_METERS);
                    setPickup(pl.pickup_address ?? "");
                    setOpen(true);
                    setError("");
                  }}
                  className="text-[0.75rem] font-semibold text-racing"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(pl.id, Number(pl.tool_count))}
                  className="text-[0.75rem] font-semibold text-muted"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="rounded-lg border border-steelLight px-3 py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt"
        >
          {places.length === 0 ? "Add a place" : "Add another place"}
        </button>
      )}

      {open && (
        <div className="mt-2 border-t border-cardBorder pt-2.5">
          <label
            htmlFor="place-label"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            What do you call it?
          </label>
          <input
            id="place-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="The cabin"
            className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />

          <label
            htmlFor="place-address"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            Address
          </label>
          <input
            id="place-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="1600 Ridge Rd, Sonoma CA"
            className="mb-1 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />
          <p className="mb-2 text-[0.688rem] leading-relaxed text-muted">
            Used once, to place a random point nearby. The address itself is never stored as the area and
            never appears on the map — same as your main location.
          </p>

          <label
            htmlFor="place-radius"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            How far the pin can land from it
          </label>
          <select
            id="place-radius"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          >
            {RADIUS_CHOICES.map((choice) => (
              <option key={choice.meters} value={choice.meters}>
                {choice.label}
              </option>
            ))}
          </select>

          <label
            htmlFor="place-pickup"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            Pickup address here (optional)
          </label>
          <input
            id="place-pickup"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
            placeholder="Same address, or a spot nearby"
            className="mb-1 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />
          <p className="mb-2 text-[0.688rem] leading-relaxed text-muted">
            Offered when you list a tool here. Still only reaches a borrower whose specific request you have
            approved.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-lg bg-safety px-3 py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt disabled:opacity-40"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add this place"}
            </button>
            <button type="button" onClick={reset} className="text-[0.75rem] font-semibold text-racing">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const CATEGORIES = ["Power", "Hand", "Yard", "Ladder", "Paint", "Garden", "Electrical", "Measure", "Cutting", "Other"];
const DURATION_UNITS = [
  { value: "hour", label: "Hour" },
  { value: "half_day", label: "Half day" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export default function ListTool() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("single");
  const [portable, setPortable] = useState(true);
  const [supervisedRequired, setSupervisedRequired] = useState(false);
  const [monetize, setMonetize] = useState(false);
  const [price, setPrice] = useState("");
  const [durationUnit, setDurationUnit] = useState("day");
  const [pickupLocation, setPickupLocation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim() && description.trim() && pickupLocation.trim() && (!monetize || price);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const { data, error } = await supabase
      .from("tools")
      .insert({
        crib_id: user.id,
        name: name.trim(),
        category: category || null,
        description: description.trim(),
        kind,
        portable,
        supervised_required: portable ? false : supervisedRequired,
        monetize,
        price: monetize ? Number(price) : null,
        price_duration_unit: monetize ? durationUnit : null,
        pickup_location: pickupLocation.trim(),
      })
      .select("id")
      .single();

    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    // Analytics — every meaningful new action logs an events row (see CLAUDE.md → Patterns to Follow)
    await supabase.from("events").insert({ profile_id: user.id, event_type: "tool_listed", metadata: { tool_id: data.id } });

    navigate("/my-tools", { replace: true });
  }

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2.5 bg-asphalt px-4 py-3.5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="font-condensed text-base font-bold uppercase tracking-wide text-safety">List a Tool</p>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4">
        <p className="mb-4 rounded-lg border border-dashed border-cardBorder bg-white p-2.5 text-xs leading-relaxed text-muted">
          Photo upload isn't wired up yet (needs a Supabase Storage bucket) — this tool will list without a photo for now.
        </p>

        <div className="mb-3.5">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Tool name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wet tile saw"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">
            Category <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          >
            <option value="">No category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="mb-3.5">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Condition, what it's good for, anything a borrower should know…"
            className="w-full resize-none rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wide text-muted">Kind</label>
          <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
            {[["single", "Single tool"], ["set", "Set of tools"]].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setKind(val)}
                className={`flex-1 rounded-md py-2 font-mono text-[10.5px] font-bold uppercase ${
                  kind === val ? "bg-asphalt text-safety" : "text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3.5">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wide text-muted">Access</label>
          <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
            {[[true, "Portable"], [false, "Stationary"]].map(([val, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setPortable(val)}
                className={`flex-1 rounded-md py-2 font-mono text-[10.5px] font-bold uppercase ${
                  portable === val ? "bg-asphalt text-safety" : "text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!portable && (
          <label className="mb-3.5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
            <span className="text-sm font-semibold text-asphalt">Requires supervision</span>
            <input type="checkbox" checked={supervisedRequired} onChange={(e) => setSupervisedRequired(e.target.checked)} />
          </label>
        )}

        <div className="mb-3.5">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Pickup location</label>
          <input
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            placeholder="e.g. 142 Birchwood Ct (only shared after you approve a request)"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
          <p className="mt-1 text-[11px] text-muted">Private — never shown to anyone until you approve their specific request.</p>
        </div>

        <label className="mb-3.5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
          <span className="text-sm font-semibold text-asphalt">Charge a rental fee?</span>
          <input type="checkbox" checked={monetize} onChange={(e) => setMonetize(e.target.checked)} />
        </label>

        {monetize && (
          <div className="mb-3.5 flex gap-2">
            <div className="flex w-28 items-center rounded-lg border border-cardBorder bg-white pl-3">
              <span className="text-sm font-semibold text-muted">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent px-1.5 py-2.5 text-sm text-asphalt outline-none"
              />
            </div>
            <select
              value={durationUnit}
              onChange={(e) => setDurationUnit(e.target.value)}
              className="flex-1 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            >
              {DURATION_UNITS.map((d) => (
                <option key={d.value} value={d.value}>per {d.label.toLowerCase()}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-signal">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-40"
        >
          {saving ? "Listing…" : "List This Tool"}
        </button>
      </form>
    </div>
  );
}

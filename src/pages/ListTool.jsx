import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { uploadToolPhoto } from "../lib/photos";
import { useAuth } from "../contexts/AuthContext";
import CategoryCombobox from "../components/CategoryCombobox";

const DURATION_UNITS = [
  { value: "hour", label: "Hour" },
  { value: "half_day", label: "Half day" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const MAX_PHOTOS = 3;

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
  const [forSale, setForSale] = useState(false);
  const [askingPrice, setAskingPrice] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [photos, setPhotos] = useState([]); // [{ file, previewUrl }]
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit =
    name.trim() && description.trim() && pickupLocation.trim() && (!monetize || price) && (!forSale || askingPrice);

  function addPhotos(fileList) {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const picked = Array.from(fileList).slice(0, room);
    setPhotos((prev) => [...prev, ...picked.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removePhoto(index) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);

    // Photos upload before the tool row exists -- the path is
    // {crib_id}/{random}.{ext}, no tool id involved (see
    // 0016_tool_photos_storage.sql), so there's nothing to wait on here.
    // Uploaded one at a time rather than in parallel so a failure partway
    // through doesn't leave an ambiguous number of orphaned files.
    let photoPaths;
    try {
      photoPaths = [];
      for (const { file } of photos) {
        photoPaths.push(await uploadToolPhoto(user.id, file));
      }
    } catch (err) {
      setSaving(false);
      setError(err.message ?? "Couldn't upload one of the photos.");
      return;
    }

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
        for_sale: forSale,
        asking_price: forSale ? Number(askingPrice) : null,
        pickup_location: pickupLocation.trim(),
        photos: photoPaths,
      })
      .select("id")
      .single();

    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    // Analytics — every meaningful new action logs an events row (see CLAUDE.md → Patterns to Follow)
    await logEvent(user.id, EVENTS.TOOL_LISTED, { tool_id: data.id });

    navigate("/my-tools", { replace: true });
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
        <p className="font-condensed text-base font-bold uppercase tracking-wide text-safety">List a Tool</p>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4">
        <fieldset className="mb-3.5 border-0 p-0">
          <legend className="mb-1.5 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Photos <span className="normal-case text-[#B0AEA6]">(optional, up to {MAX_PHOTOS})</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.previewUrl} className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-cardBorder">
                <img src={p.previewUrl} alt={`Preview ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-asphalt/80 text-safety"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="h-2 w-2">
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="flex h-16 w-16 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-cardBorder bg-white text-muted">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </fieldset>

        <div className="mb-3.5">
          <label htmlFor="tool-tool-name" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Tool name</label>
          <input
            id="tool-tool-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wet tile saw"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <label htmlFor="tool-category-optional" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Category <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <CategoryCombobox id="tool-category-optional" value={category} onChange={setCategory} />
        </div>

        <div className="mb-3.5">
          <label htmlFor="tool-description" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Description</label>
          <textarea
            id="tool-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Condition, what it's good for, anything a borrower should know…"
            className="w-full resize-none rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <fieldset className="border-0 p-0">
            <legend className="mb-1.5 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Kind</legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
            {[["single", "Single tool"], ["set", "Set of tools"]].map(([val, label]) => (
              <button
                key={val}
                type="button"
                aria-pressed={kind === val}
                onClick={() => setKind(val)}
                className={`flex-1 rounded-md py-2 font-mono text-[0.656rem] font-bold uppercase ${
                  kind === val ? "bg-asphalt text-safety" : "text-ink"
                }`}
              >
                {label}
              </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mb-3.5">
          <fieldset className="border-0 p-0">
            <legend className="mb-1.5 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Access</legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
            {[[true, "Portable"], [false, "Stationary"]].map(([val, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={portable === val}
                onClick={() => setPortable(val)}
                className={`flex-1 rounded-md py-2 font-mono text-[0.656rem] font-bold uppercase ${
                  portable === val ? "bg-asphalt text-safety" : "text-ink"
                }`}
              >
                {label}
              </button>
              ))}
            </div>
          </fieldset>
        </div>

        {!portable && (
          <label className="mb-3.5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
            <span className="text-sm font-semibold text-asphalt">Requires supervision</span>
            <input type="checkbox" checked={supervisedRequired} onChange={(e) => setSupervisedRequired(e.target.checked)} />
          </label>
        )}

        <div className="mb-3.5">
          <label htmlFor="tool-pickup-location" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Pickup location</label>
          <input
            id="tool-pickup-location"
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            placeholder="e.g. 142 Birchwood Ct (only shared after you approve a request)"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
          <p className="mt-1 text-[0.688rem] text-muted">Private — never shown to anyone until you approve their specific request.</p>
        </div>

        <label className="mb-3.5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
          <span className="text-sm font-semibold text-asphalt">Monetize?</span>
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

        <label className="mb-3.5 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
          <span className="text-sm font-semibold text-asphalt">Open to sell?</span>
          <input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
        </label>

        {forSale && (
          <div className="mb-3.5">
            <label htmlFor="tool-asking-price" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">Asking price</label>
            <div className="flex w-28 items-center rounded-lg border border-cardBorder bg-white pl-3">
              <span className="text-sm font-semibold text-muted">$</span>
              <input
                id="tool-asking-price"
                type="number"
                min="0"
                step="0.01"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent px-1.5 py-2.5 text-sm text-asphalt outline-none"
              />
            </div>
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

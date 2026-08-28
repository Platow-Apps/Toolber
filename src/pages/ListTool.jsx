import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { removeToolPhotos, shrinkImage, toolPhotoUrl, uploadToolPhoto } from "../lib/photos";
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
const CONDITIONS = [
  ["new", "New"],
  ["good", "Good"],
  ["fair", "Fair"],
];

// One component serves both /my-tools/new and /my-tools/:id/edit -- the form
// is identical, only the load and the save differ, and keeping them together
// means a field added to one can never be forgotten in the other.
export default function ListTool() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [condition, setCondition] = useState("");
  const [brand, setBrand] = useState("");
  const [kind, setKind] = useState("single");
  const [portable, setPortable] = useState(true);
  const [supervisedRequired, setSupervisedRequired] = useState(false);
  const [monetize, setMonetize] = useState(false);
  const [price, setPrice] = useState("");
  const [durationUnit, setDurationUnit] = useState("day");
  const [forSale, setForSale] = useState(false);
  const [askingPrice, setAskingPrice] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [defaultLoanDays, setDefaultLoanDays] = useState("");
  // Each entry is either an already-stored photo ({ path, previewUrl }) or a
  // newly picked one ({ file, previewUrl }). Keeping both in one ordered list
  // is what lets an owner reorder/remove old and new photos together.
  const [photos, setPhotos] = useState([]);
  const [removedPaths, setRemovedPaths] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const canSubmit =
    name.trim() && category && condition && pickupLocation.trim() && (!monetize || price);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;

    (async () => {
      // pickup_location and asking_price are not readable as columns -- both
      // are column-REVOKEd and reachable only through their owner-checked
      // RPCs (see CLAUDE.md -> Patterns to Follow). Fetched alongside the row
      // rather than after it so the form fills in one paint.
      const [{ data: tool, error: toolErr }, { data: pickup }, { data: asking }] = await Promise.all([
        supabase
          .from("tools")
          .select("id, chest_id, name, category, kind, portable, supervised_required, monetize, price, price_duration_unit, for_sale, default_loan_days, subcategory, condition, brand, photos")
          .eq("id", id)
          .single(),
        supabase.rpc("get_pickup_location", { p_tool_id: id }),
        supabase.rpc("get_asking_price", { p_tool_id: id }),
      ]);
      if (cancelled) return;

      if (toolErr) {
        setError(toolErr.message);
        setLoading(false);
        return;
      }
      if (tool.chest_id !== user.id) {
        // RLS lets anyone read a tool row, so this is a real reachable state,
        // not just a belt-and-braces check.
        setError("That isn't your tool to edit.");
        setLoading(false);
        return;
      }

      setName(tool.name ?? "");
      setCategory(tool.category ?? "");
      setSubcategory(tool.subcategory ?? "");
      setCondition(tool.condition ?? "");
      setBrand(tool.brand ?? "");
      setKind(tool.kind ?? "single");
      setPortable(tool.portable ?? true);
      setSupervisedRequired(tool.supervised_required ?? false);
      setMonetize(tool.monetize ?? false);
      setPrice(tool.price == null ? "" : String(tool.price));
      setDurationUnit(tool.price_duration_unit ?? "day");
      setForSale(tool.for_sale ?? false);
      setAskingPrice(asking == null ? "" : String(asking));
      setPickupLocation(pickup ?? "");
      setDefaultLoanDays(tool.default_loan_days == null ? "" : String(tool.default_loan_days));
      setPhotos((tool.photos ?? []).map((path) => ({ path, previewUrl: toolPhotoUrl(path) })));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit, id, user.id]);

  function addPhotos(fileList) {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const picked = Array.from(fileList).slice(0, room);
    setPhotos((prev) => [...prev, ...picked.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removePhoto(index) {
    setPhotos((prev) => {
      const target = prev[index];
      if (target.file) {
        URL.revokeObjectURL(target.previewUrl);
      } else if (target.path) {
        // Don't touch Storage yet -- the owner may still cancel out of the
        // form, and the row is the source of truth. Cleaned up only after a
        // successful save.
        setRemovedPaths((paths) => [...paths, target.path]);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);

    // Photos upload before the tool row exists -- the path is
    // {chest_id}/{random}.{ext}, no tool id involved (see
    // 0016_tool_photos_storage.sql), so there's nothing to wait on here.
    // Uploaded one at a time rather than in parallel so a failure partway
    // through doesn't leave an ambiguous number of orphaned files. Already
    // stored photos pass straight through, keeping the list's order.
    let photoPaths;
    try {
      photoPaths = [];
      for (const photo of photos) {
        photoPaths.push(photo.path ?? (await uploadToolPhoto(user.id, await shrinkImage(photo.file))));
      }
    } catch (err) {
      setSaving(false);
      setError(err.message ?? "Couldn't upload one of the photos.");
      return;
    }

    const fields = {
      name: name.trim(),
      category: category || null,
      subcategory: subcategory || null,
      condition,
      brand: brand.trim() || null,
      kind,
      portable,
      supervised_required: portable ? false : supervisedRequired,
      monetize,
      price: monetize ? Number(price) : null,
      price_duration_unit: monetize ? durationUnit : null,
      for_sale: forSale,
      // Optional -- an owner can be open to sell without naming a price
      // upfront and let a buyer just Inquire.
      asking_price: forSale && askingPrice ? Number(askingPrice) : null,
      pickup_location: pickupLocation.trim(),
      // Optional -- pre-fills the borrower's requested duration; a blank
      // listing falls back to the one-week default in request_borrow().
      default_loan_days: defaultLoanDays ? Number(defaultLoanDays) : null,
      photos: photoPaths,
    };

    const { data, error } = isEdit
      ? await supabase.from("tools").update(fields).eq("id", id).select("id").single()
      : await supabase.from("tools").insert({ chest_id: user.id, ...fields }).select("id").single();

    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    // Only now that the row no longer references them -- doing this before the
    // save would destroy the photos of a listing that then failed to update.
    if (removedPaths.length > 0) await removeToolPhotos(removedPaths);

    // Analytics — every meaningful new action logs an events row (see CLAUDE.md → Patterns to Follow)
    await logEvent(user.id, isEdit ? EVENTS.TOOL_UPDATED : EVENTS.TOOL_LISTED, { tool_id: data.id });

    navigate("/my-tools", { replace: true });
  }

  if (loading) {
    return (
      <div className="flex min-h-app items-center justify-center bg-page">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
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
        <p className="font-condensed text-base font-bold uppercase tracking-wide text-safety">
          {isEdit ? "Edit Tool" : "List a Tool"}
        </p>
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
          <label htmlFor="tool-tool-name" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            <span className="text-signal">*</span> Tool name
          </label>
          <input
            id="tool-tool-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wet tile saw"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
        </div>

        <div className="mb-3.5">
          <label htmlFor="tool-category" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            <span className="text-signal">*</span> Category
          </label>
          <CategoryCombobox
            id="tool-category"
            category={category}
            subcategory={subcategory}
            onChange={({ category: c, subcategory: sc }) => {
              setCategory(c);
              setSubcategory(sc);
            }}
          />
        </div>

        <div className="mb-3.5">
          <fieldset className="border-0 p-0">
            <legend className="mb-1.5 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              <span className="text-signal">*</span> Condition
            </legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
              {CONDITIONS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={condition === val}
                  onClick={() => setCondition(val)}
                  className={`flex-1 rounded-md py-2 font-mono text-[0.656rem] font-bold uppercase ${
                    condition === val ? "bg-asphalt text-safety" : "text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mb-3.5">
          <label htmlFor="tool-brand" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Brand <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <input
            id="tool-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. DeWalt, Ridgid, Makita"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
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
          <label htmlFor="tool-pickup-location" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            <span className="text-signal">*</span> Pickup location
          </label>
          <input
            id="tool-pickup-location"
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            placeholder="e.g. 142 Birchwood Ct (only shared after you approve a request)"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
          <p className="mt-1 text-[0.688rem] text-muted">Private — never shown to anyone until you approve their specific request.</p>
        </div>

        <div className="mb-3.5">
          <label htmlFor="tool-loan-days" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Usual lending period <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <div className="flex w-40 items-center rounded-lg border border-cardBorder bg-white pr-3">
            <input
              id="tool-loan-days"
              type="number"
              min="1"
              max="365"
              value={defaultLoanDays}
              onChange={(e) => setDefaultLoanDays(e.target.value)}
              placeholder="7"
              className="w-full bg-transparent px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <span className="text-sm font-semibold text-muted">days</span>
          </div>
          <p className="mt-1 text-[0.688rem] text-muted">
            Pre-fills how long borrowers ask for. You still approve each request, and can change the length then.
          </p>
        </div>

        <div className="mb-3.5 rounded-lg border border-cardBorder bg-white p-3">
          <p className="text-sm font-semibold text-asphalt">$ Monetize?</p>
          <p className="mb-2.5 mt-0.5 text-[0.688rem] text-muted">Rent it out, sell it, both, or neither.</p>

          <label className="flex items-center justify-between py-1.5">
            <span className="text-sm text-asphalt">Rent out?</span>
            <input type="checkbox" checked={monetize} onChange={(e) => setMonetize(e.target.checked)} />
          </label>

          {monetize && (
            <div className="mb-1 mt-1 flex gap-2">
              <div className="flex w-28 items-center rounded-lg border border-cardBorder bg-white pl-3">
                <span className="text-sm font-semibold text-muted">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  // The visible "$" prefix is decorative, and this shares its
                  // placeholder with the asking-price field below, so without
                  // this the two are indistinguishable to a screen reader.
                  aria-label="Rental price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent px-1.5 py-2.5 text-sm text-asphalt outline-none"
                />
              </div>
              <select
                aria-label="Rental period"
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

          <label className="flex items-center justify-between border-t border-cardBorder py-1.5 pt-2.5">
            <span className="text-sm text-asphalt">Open to sell?</span>
            <input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
          </label>

          {forSale && (
            <div className="mt-1">
              <label htmlFor="tool-asking-price" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                Asking price <span className="normal-case text-[#B0AEA6]">(optional)</span>
              </label>
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
        </div>

        {error && <p className="mb-3 text-sm text-signal">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-40"
        >
          {saving ? (isEdit ? "Saving…" : "Listing…") : isEdit ? "Save Changes" : "List This Tool"}
        </button>
      </form>
    </div>
  );
}

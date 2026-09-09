import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CategoryCombobox from "../components/CategoryCombobox";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { EVENTS, logEvent } from "../lib/analytics";
import {
  fileFromStoredPhoto,
  hashFile,
  removeToolPhotos,
  rotateImage,
  shrinkImage,
  toolPhotoUrl,
  uploadToolPhoto,
} from "../lib/photos";
import { emptySpecs, MAX_SPECS, packSpecs, unpackSpecs } from "../lib/specs";
import { suggestCategory } from "../lib/suggestCategory";
import { supabase } from "../lib/supabaseClient";

const DURATION_UNITS = [
  { value: "hour", label: "Hour" },
  { value: "half_day", label: "Half day" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const MAX_PHOTOS = 3;
// Placeholders only — the labels are free text, since the attribute that
// matters differs completely between a drill and a ladder.
const SPEC_PLACEHOLDERS = [
  ["Power", "15 amp"],
  ["Voltage", "18V"],
  ["Size", "7-1/4 in"],
];
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
  const [specs, setSpecs] = useState(emptySpecs);
  const [kind, setKind] = useState("single");
  const [portable, setPortable] = useState(true);
  const [supervisedRequired, setSupervisedRequired] = useState(false);
  const [monetize, setMonetize] = useState(false);
  const [price, setPrice] = useState("");
  const [durationUnit, setDurationUnit] = useState("day");
  const [forSale, setForSale] = useState(false);
  const [askingPrice, setAskingPrice] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  // The address saved in Settings, if the owner opted into keeping one. Only
  // ever offered — never applied on its own, because a tool can perfectly well
  // be lent from somewhere other than home.
  const [defaultPickup, setDefaultPickup] = useState("");
  const [defaultLoanDays, setDefaultLoanDays] = useState("");
  const [generalLocation, setGeneralLocation] = useState("");
  const [revealExactLocation, setRevealExactLocation] = useState(true);
  // Each entry is either an already-stored photo ({ path, previewUrl }) or a
  // newly picked one ({ file, previewUrl }). Keeping both in one ordered list
  // is what lets an owner reorder/remove old and new photos together.
  const [photos, setPhotos] = useState([]);
  const [removedPaths, setRemovedPaths] = useState([]);
  // Index of the photo currently being rotated, so its button can say so and
  // a second tap cannot race the first.
  const [rotating, setRotating] = useState(null);
  // How many of the last picked files were already in the strip.
  const [duplicatePhotos, setDuplicatePhotos] = useState(0);
  // A same-named listing found at submit time, and whether the owner has
  // said to go ahead anyway. Held rather than blocked: owning two of the
  // same tool is perfectly ordinary, and only they can tell that from a
  // double submit.
  const [duplicateTool, setDuplicateTool] = useState(null);
  // True while the duplicate lookup is in flight. Gates the submit button,
  // which is what closes the double-click race.
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Recomputed as the name is typed. Memoised because it walks the whole
  // taxonomy, which is several hundred labels, on every keystroke.
  const suggestion = useMemo(() => suggestCategory(name), [name]);

  const canSubmit = name.trim() && category && condition && pickupLocation.trim() && (!monetize || price);

  useEffect(() => {
    // Its own read, through an RPC even though it is the owner's own row: the
    // saved pickup address is not in the profiles SELECT grant, being the same
    // class of data a tool guards per listing (0048). The invariant gate in
    // scripts/ would also flag any attempt to select it directly, which is
    // exactly what should happen.
    supabase.rpc("get_my_default_pickup").then(({ data }) => {
      setDefaultPickup(data ?? "");
    });
  }, []);

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
          .select(
            "id, chest_id, name, category, kind, portable, supervised_required, monetize, price, price_duration_unit, for_sale, default_loan_days, subcategory, condition, brand, specs, general_location, reveal_exact_location, photos, photo_hashes",
          )
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
      setSpecs(unpackSpecs(tool.specs));
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
      setGeneralLocation(tool.general_location ?? "");
      setRevealExactLocation(tool.reveal_exact_location ?? true);
      // Hashes are positional with photos, so an edit that leaves a photo
      // alone carries its hash through untouched rather than blanking it.
      setPhotos(
        (tool.photos ?? []).map((path, i) => ({
          path,
          hash: tool.photo_hashes?.[i] ?? null,
          previewUrl: toolPhotoUrl(path),
        })),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit, id, user.id]);

  /**
   * Add picked files, skipping any that is byte-for-byte a photo already in
   * the strip.
   *
   * Compared by content hash rather than by name or size: a photo re-picked
   * from a phone's gallery often arrives renamed, and two genuinely different
   * photos can share a size. Only files picked in this form are compared --
   * an already-stored photo would have to be downloaded to hash, which is a
   * lot of traffic to catch a rarer mistake than picking the same file twice.
   */
  async function addPhotos(fileList) {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    setDuplicatePhotos(0);

    const seen = new Set(photos.map((p) => p.hash).filter(Boolean));
    const added = [];
    let skipped = 0;

    for (const file of Array.from(fileList)) {
      if (added.length >= room) break;
      const hash = await hashFile(file);
      // A null hash means we could not compute one (no secure context), not
      // that the photo is new -- so it is added rather than silently dropped.
      if (hash && seen.has(hash)) {
        skipped += 1;
        continue;
      }
      if (hash) seen.add(hash);
      added.push({ file, hash, previewUrl: URL.createObjectURL(file) });
    }

    if (added.length > 0) setPhotos((prev) => [...prev, ...added]);
    if (skipped > 0) setDuplicatePhotos(skipped);
  }

  /**
   * Turn one photo a quarter turn clockwise.
   *
   * A stored photo has to come back down before it can go back up: the
   * rotated copy is a genuinely different image, so it uploads as a new file
   * and the old path joins the removal list, exactly as replacing it by hand
   * would. Nothing is deleted from Storage until the form is saved, so
   * abandoning the edit leaves the original in place.
   */
  async function rotatePhoto(index) {
    const target = photos[index];
    if (!target || rotating !== null) return;
    setRotating(index);
    setError("");

    const source = target.file ?? (await fileFromStoredPhoto(target.path));
    if (!source) {
      setRotating(null);
      setError("Couldn't load that photo to rotate it. Try removing and re-adding it.");
      return;
    }

    const rotated = await rotateImage(source);
    if (rotated === source && !target.file) {
      // Nothing changed and there is no local copy to keep -- leave the
      // stored photo exactly as it was rather than re-uploading a duplicate.
      setRotating(null);
      setError("This browser couldn't rotate that image.");
      return;
    }

    setPhotos((prev) =>
      prev.map((photo, i) => {
        if (i !== index) return photo;
        if (photo.file) URL.revokeObjectURL(photo.previewUrl);
        return { file: rotated, previewUrl: URL.createObjectURL(rotated) };
      }),
    );
    // Queued for cleanup only once the save succeeds, same as a removal.
    if (target.path) setRemovedPaths((paths) => [...paths, target.path]);
    setRotating(null);
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

    // Runs on edits too, excluding the tool being edited: renaming "Heat Gun"
    // to "Heater Gun" creates exactly the collision this exists to catch, and
    // the old exact-match check never looked.
    //
    // `checking` gates the button as well as this branch. Without it the two
    // fast clicks that produce a duplicate both got past the lookup before
    // either reached setSaving -- the race this check is largely here to
    // prevent.
    if (!duplicateTool) {
      setChecking(true);
      const { data: similar } = await supabase.rpc("find_similar_tools", {
        p_name: name.trim(),
        p_photo_hashes: photos.map((photo) => photo.hash ?? null).filter(Boolean),
        p_exclude_tool_id: isEdit ? id : null,
      });
      setChecking(false);

      if (similar?.length) {
        // A warning, not a constraint. Two of the same tool is perfectly
        // ordinary -- a spare drill, two ladders -- and nothing but the owner
        // can tell that apart from a double submit.
        setDuplicateTool(similar[0]);
        return;
      }
    }

    setSaving(true);

    // Photos upload before the tool row exists -- the path is
    // {chest_id}/{random}.{ext}, no tool id involved (see
    // 0016_tool_photos_storage.sql), so there's nothing to wait on here.
    // Uploaded one at a time rather than in parallel so a failure partway
    // through doesn't leave an ambiguous number of orphaned files. Already
    // stored photos pass straight through, keeping the list's order.
    let photoPaths;
    let photoHashes;
    try {
      photoPaths = [];
      // Positional with photoPaths, so a row's hashes always describe its own
      // photos. Null where one could not be computed -- an image stored before
      // 0049, or a client with no crypto.subtle.
      photoHashes = [];
      for (const photo of photos) {
        photoPaths.push(photo.path ?? (await uploadToolPhoto(user.id, await shrinkImage(photo.file))));
        photoHashes.push(photo.hash ?? null);
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
      specs: packSpecs(specs),
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
      reveal_exact_location: revealExactLocation,
      // Only meaningful when the exact address is withheld.
      general_location: revealExactLocation ? null : generalLocation.trim() || null,
      // Optional -- pre-fills the borrower's requested duration; a blank
      // listing falls back to the one-week default in request_borrow().
      default_loan_days: defaultLoanDays ? Number(defaultLoanDays) : null,
      photos: photoPaths,
      photo_hashes: photoHashes,
    };

    const { data, error } = isEdit
      ? await supabase.from("tools").update(fields).eq("id", id).select("id").single()
      : await supabase
          .from("tools")
          .insert({ chest_id: user.id, ...fields })
          .select("id")
          .single();

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
      <PageHeader title={isEdit ? "Edit Tool" : "List a Tool"} backTo="/my-tools" />

      <form onSubmit={handleSubmit} className="px-4 py-4">
        <fieldset className="mb-3.5 border-0 p-0">
          <legend className="mb-1.5 block font-mono text-[0.688rem] uppercase tracking-wide text-muted">
            Photos <span className="normal-case text-[#B0AEA6]">(optional, up to {MAX_PHOTOS})</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div
                key={p.previewUrl}
                className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-cardBorder"
              >
                <img src={p.previewUrl} alt={`Preview ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-asphalt/80 text-safety"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="h-2 w-2"
                  >
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                </button>
                {/* Bottom-left, opposite the remove button: a phone that got
                    the orientation wrong is the commonest thing wrong with an
                    uploaded photo, and it is only fixable while you can see
                    the picture. */}
                <button
                  type="button"
                  onClick={() => rotatePhoto(i)}
                  disabled={rotating !== null}
                  aria-label={`Rotate photo ${i + 1} a quarter turn`}
                  className="absolute bottom-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-asphalt/80 text-safety disabled:opacity-50"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-2.5 w-2.5 ${rotating === i ? "animate-spin" : ""}`}
                  >
                    <path d="M21 12a9 9 0 1 1-3.5-7.1" />
                    <polyline points="21 3 21 9 15 9" />
                  </svg>
                </button>
              </div>
            ))}
            {duplicatePhotos > 0 && (
              <p className="w-full text-[0.75rem] leading-relaxed text-muted">
                {duplicatePhotos === 1
                  ? "That photo was already added, so it wasn't added twice."
                  : `${duplicatePhotos} of those photos were already added, so they weren't added twice.`}
              </p>
            )}
            {photos.length < MAX_PHOTOS && (
              <label className="flex h-16 w-16 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-cardBorder bg-white text-muted">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="h-5 w-5"
                >
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
          <label
            htmlFor="tool-tool-name"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
          >
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
          <label
            htmlFor="tool-category"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
          >
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

          {/* Offered, never applied. A tool's name usually is its category, so
              making someone hunt through several hundred subcategories to say
              what they just typed is the app asking them to do its
              arithmetic — but the guess is a string match and is wrong often
              enough that accepting it has to be a decision. Shown only while
              the field is empty, so it never argues with a choice already
              made. */}
          {!category && suggestion && (
            <button
              type="button"
              onClick={() => {
                setCategory(suggestion.category);
                setSubcategory(suggestion.subcategory ?? "");
              }}
              className="mt-1.5 flex w-full items-start gap-2 rounded-lg border border-cardBorder bg-white px-2.5 py-2 text-left"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#F2B90B"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
              >
                <path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z" />
              </svg>
              <span className="text-[0.75rem] leading-snug text-asphalt">
                Looks like <b className="font-semibold">{suggestion.category}</b>
                {suggestion.subcategory ? ` — ${suggestion.subcategory}` : ""}
                <span className="block text-[0.719rem] text-muted">Tap to use it</span>
              </span>
            </button>
          )}
        </div>

        <div className="mb-3.5">
          <fieldset className="border-0 p-0">
            <legend className="mb-1.5 block font-mono text-[0.688rem] uppercase tracking-wide text-muted">
              <span className="text-signal">*</span> Condition
            </legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
              {CONDITIONS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={condition === val}
                  onClick={() => setCondition(val)}
                  className={`flex-1 rounded-md py-2 font-mono text-[0.688rem] font-bold uppercase ${
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
          <label
            htmlFor="tool-brand"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
          >
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

        <fieldset className="mb-3.5 border-0 p-0">
          <legend className="mb-1.5 block font-mono text-[0.688rem] uppercase tracking-wide text-muted">
            Specs <span className="normal-case text-[#B0AEA6]">(optional, up to {MAX_SPECS})</span>
          </legend>
          <div className="space-y-1.5">
            {specs.map((row, i) => (
              // Index-keyed on purpose: these are three fixed slots, not a
              // reorderable list — row 2 is always row 2.
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length slots
              <div key={i} className="flex gap-1.5">
                <input
                  aria-label={`Spec ${i + 1} name`}
                  value={row.label}
                  onChange={(e) =>
                    setSpecs((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                  }
                  placeholder={SPEC_PLACEHOLDERS[i][0]}
                  className="w-1/3 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
                />
                <input
                  aria-label={`Spec ${i + 1} value`}
                  value={row.value}
                  onChange={(e) =>
                    setSpecs((prev) => prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                  placeholder={SPEC_PLACEHOLDERS[i][1]}
                  className="flex-1 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[0.75rem] text-muted">
            Whatever matters for this tool — voltage, size, length, weight limit. Rows with only one half
            filled in are skipped.
          </p>
        </fieldset>

        <div className="mb-3.5">
          <fieldset className="border-0 p-0">
            <legend className="mb-1.5 block font-mono text-[0.688rem] uppercase tracking-wide text-muted">
              Kind
            </legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
              {[
                ["single", "Single tool"],
                ["set", "Set of tools"],
              ].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={kind === val}
                  onClick={() => setKind(val)}
                  className={`flex-1 rounded-md py-2 font-mono text-[0.688rem] font-bold uppercase ${
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
            <legend className="mb-1.5 block font-mono text-[0.688rem] uppercase tracking-wide text-muted">
              Access
            </legend>
            <div className="flex gap-1.5 rounded-lg border border-cardBorder bg-white p-1">
              {[
                [true, "Portable"],
                [false, "Stationary"],
              ].map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={portable === val}
                  onClick={() => setPortable(val)}
                  className={`flex-1 rounded-md py-2 font-mono text-[0.688rem] font-bold uppercase ${
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
            <input
              type="checkbox"
              checked={supervisedRequired}
              onChange={(e) => setSupervisedRequired(e.target.checked)}
            />
          </label>
        )}

        <div className="mb-3.5">
          <label
            htmlFor="tool-pickup-location"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
          >
            <span className="text-signal">*</span> Pickup location
          </label>
          <input
            id="tool-pickup-location"
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            placeholder="e.g. 142 Birchwood Ct (only shared after you approve a request)"
            className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
          />
          {/* Most people lend every tool from the same place, so the second
              listing onwards was retyping an address the app already had.

              A checkbox rather than a button, matching Settings and Search
              near: it shows whether this listing *is* on the default location,
              which a button could only ever set and never report. Ticked state
              is derived from the field rather than kept separately, so editing
              the address by hand unticks it on its own. */}
          {defaultPickup && (
            <label className="mt-1.5 flex items-start gap-2">
              <input
                type="checkbox"
                checked={pickupLocation === defaultPickup}
                onChange={(e) => setPickupLocation(e.target.checked ? defaultPickup : "")}
                className="mt-0.5"
              />
              <span className="text-[0.75rem] leading-snug text-asphalt">
                Use my default location
                <span className="block text-[0.75rem] text-muted">{defaultPickup}</span>
              </span>
            </label>
          )}
          <p className="mt-1 text-[0.75rem] text-muted">
            Private — never shown to anyone until you approve their specific request.
          </p>
        </div>

        {/* Approving used to hand over the exact street address automatically.
            This lets an owner approve a borrow without that, and share the
            precise spot by message once they've decided they want to
            (0033_lender_controlled_disclosure.sql). */}
        <label className="mb-2 flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
          <span className="pr-3 text-sm font-semibold text-asphalt">
            Share the exact address when I approve
          </span>
          <input
            type="checkbox"
            checked={revealExactLocation}
            onChange={(e) => setRevealExactLocation(e.target.checked)}
          />
        </label>

        {!revealExactLocation && (
          <div className="mb-3.5">
            <label
              htmlFor="tool-general-location"
              className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
            >
              General location <span className="normal-case text-[#B0AEA6]">(optional)</span>
            </label>
            <input
              id="tool-general-location"
              value={generalLocation}
              onChange={(e) => setGeneralLocation(e.target.value)}
              placeholder="e.g. Near Oak Hill Park — I'll send the address"
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <p className="mt-1 text-[0.75rem] text-muted">
              This is what an approved borrower sees instead of your address. Leave it blank and they'll just
              be told you'll message them.
            </p>
          </div>
        )}

        <div className="mb-3.5">
          <label
            htmlFor="tool-loan-days"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
          >
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
          <p className="mt-1 text-[0.75rem] text-muted">
            Pre-fills how long borrowers ask for. You still approve each request, and can change the length
            then.
          </p>
        </div>

        <div className="mb-3.5 rounded-lg border border-cardBorder bg-white p-3">
          <p className="text-sm font-semibold text-asphalt">$ Monetize?</p>
          <p className="mb-2.5 mt-0.5 text-[0.75rem] text-muted">Rent it out, sell it, both, or neither.</p>

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
                  <option key={d.value} value={d.value}>
                    per {d.label.toLowerCase()}
                  </option>
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
              <label
                htmlFor="tool-asking-price"
                className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
              >
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

        {/* Not an error and not a block. Someone can own two of the same tool,
            and the only person who can tell that from a double submit is the
            one filling the form — so this says what it found and gets out of
            the way. Submitting again goes through. */}
        {duplicateTool && (
          <div className="mb-3 rounded-lg border border-cardBorder bg-[#FDF6E3] p-3">
            <p className="mb-1 text-[0.813rem] leading-relaxed text-asphalt">
              <b>{duplicateTool.name}</b> already listed — is this a duplicate?
            </p>
            <p className="mb-2 text-[0.75rem] leading-relaxed text-muted">
              {duplicateTool.matched_photo
                ? "It uses the same photo, so this is very likely the same tool."
                : "If it's a second one, carry on — otherwise you may have meant to edit the first."}
            </p>
            <button
              type="button"
              onClick={() => navigate(`/my-tools/${duplicateTool.id}/edit`)}
              className="text-[0.75rem] font-semibold text-racing underline"
            >
              Edit the one I already have
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || saving || checking}
          className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-40"
        >
          {checking
            ? "Checking…"
            : saving
              ? isEdit
                ? "Saving…"
                : "Listing…"
              : duplicateTool
                ? "List it anyway"
                : isEdit
                  ? "Save Changes"
                  : "List This Tool"}
        </button>
      </form>
    </div>
  );
}

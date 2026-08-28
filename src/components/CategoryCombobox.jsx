import { useMemo, useState } from "react";
import { CATEGORY_OPTIONS, categoryLabel } from "../lib/toolCategories";
import { useDismissableMenu } from "../lib/useDismissableMenu";

// Showing all 426 options at once is pointless scrolling; the list is there
// to be typed at, and this keeps the unfiltered view to a browsable size.
const MAX_VISIBLE = 60;

/**
 * Searchable category picker over the full two-level taxonomy — type any part
 * of either half ("brake", "automotive", "auto brake") and matching
 * subcategories surface directly, rather than making someone first guess
 * which of 37 top-level categories a thing lives under.
 *
 * Both halves are stored: `category` and `subcategory` are separate columns
 * (0026_listing_fields.sql) and both feed the search vector.
 *
 * @param {object} props
 * @param {string} props.category       parent category ("" = none selected)
 * @param {string} props.subcategory    child, may be "" for a bare category
 * @param {(next: {category: string, subcategory: string}) => void} props.onChange
 * @param {string} [props.id]
 */
export default function CategoryCombobox({ category, subcategory = "", onChange, id }) {
  const { open, setOpen, ref } = useDismissableMenu();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return CATEGORY_OPTIONS.slice(0, MAX_VISIBLE);
    // Every term must appear somewhere in the label, so "auto brake" narrows
    // rather than matching everything automotive plus everything braking.
    return CATEGORY_OPTIONS.filter((o) => {
      const haystack = o.label.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    }).slice(0, MAX_VISIBLE);
  }, [query]);

  function pick(option) {
    onChange({ category: option.category, subcategory: option.subcategory });
    setQuery("");
    setOpen(false);
  }

  const selectedLabel = categoryLabel(category, subcategory);

  return (
    <div ref={ref} className="relative">
      {selectedLabel ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt">
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          <button
            type="button"
            onClick={() => onChange({ category: "", subcategory: "" })}
            aria-label="Clear category"
            className="flex-shrink-0 text-muted"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
              <line x1="4" y1="4" x2="20" y2="20" />
              <line x1="20" y1="4" x2="4" y2="20" />
            </svg>
          </button>
        </div>
      ) : (
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search e.g. “drill”, “brake”, “ladder”…"
          className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
        />
      )}

      {open && !selectedLabel && (
        <div role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-cardBorder bg-white py-1 shadow-lg">
          {results.length === 0 && <p className="px-3 py-2 text-sm text-muted">No matching categories</p>}
          {results.map((o) => (
            <button
              key={o.label}
              type="button"
              role="option"
              aria-selected={o.category === category && o.subcategory === subcategory}
              onClick={() => pick(o)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-page ${
                o.subcategory ? "text-asphalt" : "font-semibold text-asphalt"
              }`}
            >
              {o.subcategory ? (
                <>
                  <span className="text-muted">{o.category} — </span>
                  {o.subcategory}
                </>
              ) : (
                o.label
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

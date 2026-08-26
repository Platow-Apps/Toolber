import { useMemo, useState } from "react";
import { TOOL_CATEGORIES } from "../lib/toolCategories";
import { useDismissableMenu } from "../lib/useDismissableMenu";

const OTHER = "Other";
const ALL_OPTIONS = [...TOOL_CATEGORIES, OTHER];

/**
 * Single-select searchable category picker — type to filter, click to pick,
 * "Other" always available as a catch-all. Category stays optional and
 * free-text at the schema level (see 0001_init.sql); this only controls
 * what value ends up in it. Replaces the plain <select> that couldn't
 * reasonably hold 37 real categories.
 *
 * @param {object} props
 * @param {string} props.value      current category ("" = none selected)
 * @param {(next: string) => void} props.onChange
 * @param {string} [props.id]
 */
export default function CategoryCombobox({ value, onChange, id }) {
  const { open, setOpen, ref } = useDismissableMenu();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ALL_OPTIONS.filter((c) => c.toLowerCase().includes(q)) : ALL_OPTIONS;
  }, [query]);

  function pick(category) {
    onChange(category);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt">
          <span>{value}</span>
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear category"
            className="text-muted"
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
          placeholder="Search categories…"
          className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
        />
      )}

      {open && !value && (
        <div role="listbox" className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-cardBorder bg-white py-1 shadow-lg">
          {results.length === 0 && <p className="px-3 py-2 text-sm text-muted">No matching categories</p>}
          {results.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === value}
              onClick={() => pick(c)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-page ${c === OTHER ? "text-muted" : "text-asphalt"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

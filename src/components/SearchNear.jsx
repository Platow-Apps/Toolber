import { useState } from "react";
import { geocodeAddress } from "../lib/geocode";
import { useDismissableMenu } from "../lib/useDismissableMenu";
import {
  clearStoredOrigin,
  describeLocateFailure,
  locateDevice,
  storeOrigin,
} from "../lib/searchOrigin";

/**
 * "Search near…" — where results are measured from.
 *
 * Three ways in, because no single one covers everyone. Typing a place works
 * always and needs no permission. The device's own location is one tap but
 * costs a browser prompt. Falling back to the person's own area needs neither,
 * and is the default for anyone signed in.
 *
 * The reason to have all three: a search origin is often *not* where you are.
 * Helping parents move, checking what's available near a rental, seeing
 * whether a neighborhood has anything before you move to it — all cases where
 * "use my location" is the wrong answer and a typed place is the right one.
 *
 * @param {object} props
 * @param {{lat: number, lng: number, label: string} | null} props.origin
 * @param {(origin: {lat: number, lng: number, label: string} | null) => void} props.onChange
 * @param {boolean} [props.canUseHome]  whether the profile has an area to fall back to
 */
export default function SearchNear({ origin, onChange, canUseHome = false }) {
  const { open, setOpen, ref } = useDismissableMenu();
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function apply(next) {
    if (next) storeOrigin(next);
    else clearStoredOrigin();
    onChange(next);
    setOpen(false);
    setPlace("");
    setError("");
  }

  async function searchPlace(e) {
    e.preventDefault();
    const typed = place.trim();
    if (!typed) return;
    setBusy(true);
    setError("");
    try {
      const { lat, lng } = await geocodeAddress(typed);
      apply({ lat, lng, label: typed });
    } catch (err) {
      // geocodeAddress throws copy already fit to show a person.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function useDevice() {
    setBusy(true);
    setError("");
    const result = await locateDevice();
    setBusy(false);
    if (!result.ok) {
      setError(describeLocateFailure(result.reason));
      return;
    }
    apply({ lat: result.lat, lng: result.lng, label: "your location" });
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-label={origin ? `Search near ${origin.label}. Change` : "Search near a place"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-steelLight"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <span className="max-w-[6rem] truncate font-mono text-[0.625rem] uppercase tracking-wide">
          {origin ? origin.label : "Near"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Search near"
          className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-panelBorder bg-panel p-3 shadow-lg"
        >
          <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Search near</p>

          <form onSubmit={searchPlace}>
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="Address, city, or ZIP"
              aria-label="Address, city, or ZIP"
              disabled={busy}
              className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-2.5 py-2 text-sm text-asphalt outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !place.trim()}
              className="mb-2 w-full rounded-lg bg-safety py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt disabled:opacity-40"
            >
              {busy ? "Looking…" : "Search here"}
            </button>
          </form>

          {error && (
            <p className="mb-2 rounded-lg bg-[#FCEBEB] p-2 text-[0.688rem] leading-relaxed text-signal">{error}</p>
          )}

          <button
            type="button"
            onClick={useDevice}
            disabled={busy}
            className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-[0.75rem] font-semibold text-steelLight hover:text-safety disabled:opacity-50"
          >
            Use my current location
          </button>

          {canUseHome && (
            <button
              type="button"
              onClick={() => apply(null)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-[0.75rem] font-semibold text-steelLight hover:text-safety"
            >
              Back to my own area
            </button>
          )}

          {!canUseHome && origin && (
            <button
              type="button"
              onClick={() => apply(null)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-[0.75rem] font-semibold text-steelLight hover:text-safety"
            >
              Clear
            </button>
          )}

          <p className="mt-1.5 px-2 text-[0.625rem] leading-relaxed text-muted">
            Only changes the order results appear in. Every tool stays searchable.
          </p>
        </div>
      )}
    </div>
  );
}

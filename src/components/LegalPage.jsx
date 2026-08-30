import { useNavigate } from "react-router-dom";
import BrandBar from "./BrandBar";

/**
 * Shared shell for the Terms and Privacy pages.
 *
 * Both are reachable while signed out — the signup form links to them, so
 * they have to render before anyone has an account. Prose gets a narrower
 * measure than the rest of the app: these are the only screens anyone reads
 * top to bottom.
 */
export default function LegalPage({ title, version, children }) {
  const navigate = useNavigate();

  return (
    <div className="pb-10">
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
      </div>

      <div className="mx-auto max-w-[42rem] px-4 py-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1.5 font-mono text-[0.688rem] uppercase tracking-wide text-muted"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>

        <h1 className="font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">{title}</h1>
        <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Version {version}</p>

        {/* Deliberately loud. This is a draft and nobody should mistake it for
            a reviewed document — least of all a neighbor relying on it. */}
        <p className="mt-4 rounded-lg border border-[#F0C4C4] bg-[#FCEBEB] p-3 text-[0.813rem] leading-relaxed text-signal">
          <b>Draft — not yet reviewed by an attorney.</b> Bracketed values are
          placeholders. Do not rely on this document.
        </p>

        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** Section heading. */
export function H({ children }) {
  return (
    <h2 className="mb-1.5 mt-6 font-condensed text-lg font-bold uppercase tracking-wide text-asphalt">
      {children}
    </h2>
  );
}

/** Body paragraph. */
export function P({ children }) {
  return <p className="mb-3 text-[0.875rem] leading-relaxed text-ink">{children}</p>;
}

/** Bulleted list. */
export function UL({ items }) {
  return (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[0.875rem] leading-relaxed text-ink">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

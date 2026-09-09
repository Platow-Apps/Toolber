import { useNavigate } from "react-router-dom";
import BrandBar from "./BrandBar";

/**
 * Shared shell for the Terms, Privacy and Guide pages.
 *
 * Both are reachable while signed out — the signup form links to them, so
 * they have to render before anyone has an account. Prose gets a narrower
 * measure than the rest of the app: these are the only screens anyone reads
 * top to bottom.
 */
export default function LegalPage({ title, version = null, children }) {
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
          className="mb-4 flex items-center gap-1.5 font-mono text-[0.75rem] uppercase tracking-wide text-muted"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>

        <h1 className="font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">{title}</h1>
        {/* Optional: the Guide shares this shell but is not a document anyone
            accepts, so stamping it with a version would imply it is. */}
        {version && (
          <p className="mt-1 font-mono text-[0.688rem] uppercase tracking-wide text-muted">Version {version}</p>
        )}

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

/**
 * Numbered list, for steps that happen in an order.
 *
 * Distinct from UL on purpose: the bulleted lists here are sets of things that
 * are all true at once, and a walkthrough is not one of those. Numbering is
 * also what makes a step referable — "stuck on 4" is a thing someone can say.
 */
export function OL({ items }) {
  return (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[0.875rem] leading-relaxed text-ink">
      {items.map((item, i) => (
        // Steps are fixed prose, so the index is a stable identity here — and
        // two steps can legitimately read the same ("Tap Continue").
        // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static content
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
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

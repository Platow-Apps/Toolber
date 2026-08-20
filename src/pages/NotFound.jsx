import { Link } from "react-router-dom";

// Any unmatched path used to render an empty page with a bottom nav and no
// explanation — see docs/audit-2026-08-20.md (FE-4).
export default function NotFound() {
  return (
    <div className="flex grow flex-col items-center justify-center px-6 py-20 text-center">
      <p className="mb-1 font-mono text-xs uppercase tracking-widest text-muted">404</p>
      <h1 className="mb-2 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
        Nothing here
      </h1>
      <p className="mb-5 max-w-xs text-sm text-ink">
        That link doesn’t point at anything — the tool or group may have been removed.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-asphalt px-5 py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety"
      >
        Back to Search
      </Link>
    </div>
  );
}

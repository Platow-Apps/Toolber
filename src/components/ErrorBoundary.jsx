import { Component } from "react";

// Without this, any render-time exception unmounts the entire React tree and
// leaves a blank white page with no way back — see docs/audit-2026-08-20.md
// (FE-4). Class component because React has no hook equivalent.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept as console for now — there is no error-reporting service wired up.
    console.error("Unhandled render error", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const detail = summarise(this.state.error);

    return (
      <div className="flex min-h-app flex-col items-center justify-center bg-page px-6 text-center">
        <h1 className="mb-2 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
          Error
        </h1>
        <p className="mb-4 max-w-sm text-sm text-ink">
          Try a refresh. If it keeps happening, send us a screenshot of this
          screen at{" "}
          <a href="mailto:support@toolber.org" className="font-semibold text-racing underline">
            support@toolber.org
          </a>{" "}
          and we'll sort it out.
        </p>

        {/* The reason the copy can ask for a screenshot: without this the
            screenshot would show nothing anyone can act on. Short and plain
            rather than a stack trace — it goes in front of a neighbor. */}
        {detail && (
          <p className="mb-5 max-w-sm break-words rounded-lg border border-cardBorder bg-white px-3 py-2 font-mono text-[0.688rem] leading-relaxed text-muted">
            {detail}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-asphalt px-5 py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => window.location.assign("/")}
            className="rounded-lg border border-steelLight px-5 py-3 font-condensed text-sm font-bold uppercase tracking-wide text-ink"
          >
            Back to Search
          </button>
        </div>

        {/* Optional chaining because `import.meta.env` is Vite's, and it does
            not exist under the AVA loader — which is the reason this screen had
            no test coverage at all until now. */}
        {import.meta.env?.DEV && (
          <pre className="mt-6 max-w-full overflow-x-auto rounded-lg bg-white p-3 text-left font-mono text-[0.688rem] text-signal">
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}

/**
 * One line a person can usefully screenshot.
 *
 * A failed dynamic import gets named explicitly because it is the one cause
 * here that is nobody's fault and always fixed by reloading: a deploy replaces
 * the hashed chunk files, and a tab that has been open across it asks for a
 * chunk that no longer exists. Left as its raw text ("Failed to fetch
 * dynamically imported module: https://…/assets/ToolMap-a1b2c3.js") it reads
 * as gibberish and tells the reader nothing about what to do.
 */
function summarise(error) {
  const raw = String(error?.message ?? error ?? "").trim();
  if (!raw) return "";

  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(raw)) {
    return "The app updated while this tab was open. A refresh loads the new version.";
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

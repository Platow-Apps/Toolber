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

    return (
      <div className="flex min-h-app flex-col items-center justify-center bg-page px-6 text-center">
        <h1 className="mb-2 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
          Something broke
        </h1>
        <p className="mb-5 max-w-sm text-sm text-ink">
          That screen hit an error and couldn’t finish loading. Reloading usually clears it.
        </p>
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          className="rounded-lg bg-asphalt px-5 py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety"
        >
          Back to Search
        </button>
        {import.meta.env.DEV && (
          <pre className="mt-6 max-w-full overflow-x-auto rounded-lg bg-white p-3 text-left font-mono text-[0.688rem] text-signal">
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}

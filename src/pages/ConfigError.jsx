import { MISSING_CONFIG_MESSAGE } from "../lib/supabaseClient";

// Shown instead of the app when the Supabase env vars are absent. Previously
// this state produced a blank page and a console warning — see
// docs/audit-2026-08-20.md (FE-6).
export default function ConfigError() {
  return (
    <div className="flex min-h-app flex-col items-center justify-center bg-page px-6 text-center">
      <h1 className="mb-2 font-condensed text-2xl font-bold uppercase tracking-wide text-asphalt">
        Not configured
      </h1>
      <p className="mb-4 max-w-sm text-sm text-ink">{MISSING_CONFIG_MESSAGE}</p>
      <pre className="max-w-full overflow-x-auto rounded-lg border border-cardBorder bg-white p-3 text-left font-mono text-[0.688rem] text-ink">
        {"cp .env.example .env\n# then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"}
      </pre>
    </div>
  );
}

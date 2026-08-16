import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const SELECT_COLUMNS =
  "id, name, category, kind, description, status, monetize, price, price_duration_unit, portable, supervised_required, crib_id, profiles(display_name)";

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase
      .from("tools")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setError(error.message);
        else setTool(data);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2.5 bg-asphalt px-4 py-3.5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="truncate font-condensed text-base font-bold uppercase tracking-wide text-safety">
          {tool?.name ?? "Tool"}
        </p>
      </div>

      <div className="px-4 py-4">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && error && <p className="text-sm text-signal">{error}</p>}

        {!loading && tool && (
          <>
            <h1 className="mb-1 font-condensed text-xl font-bold uppercase text-asphalt">{tool.name}</h1>
            <p className="mb-4 text-sm font-semibold text-ink">{tool.profiles?.display_name ?? "Unknown owner"}</p>
            <p className="mb-4 text-sm leading-relaxed text-ink">{tool.description}</p>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted">Price</p>
                <p className="text-sm font-bold text-asphalt">
                  {tool.monetize ? `$${tool.price} / ${tool.price_duration_unit?.replace("_", " ")}` : "Free"}
                </p>
              </div>
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted">Access</p>
                <p className="text-sm font-bold text-asphalt">
                  {tool.portable ? "Portable" : `Stationary${tool.supervised_required ? " · Supervised" : ""}`}
                </p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-dashed border-asphalt/20 bg-asphalt/5 p-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="#7C8087" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0">
                <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
                <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
              </svg>
              <p className="text-xs leading-relaxed text-ink">
                <b>Pickup location</b> — revealed once your request is approved.
              </p>
            </div>

            <p className="text-center text-xs text-muted">
              Request-to-borrow isn't wired up yet — next build pass. See toolber-tool-detail.html for the design.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

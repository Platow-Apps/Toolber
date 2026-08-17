import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";

// mapbox-gl is large (~2MB) — lazy-loaded so it's only fetched by people who
// actually switch to Map view, not everyone browsing the list.
const ToolMap = lazy(() => import("../components/ToolMap"));

const SELECT_COLUMNS =
  "id, name, category, description, status, monetize, price, price_duration_unit, crib_id, search_vector, profiles(display_name, approx_lat, approx_lng, map_pin_hidden)";

const STATUS_STYLE = {
  available: "bg-[#E9F3E9] text-[#2E6B2E]",
  requested: "bg-[#FCF1D6] text-[#8A6300]",
  borrowed: "bg-[#EEECE8] text-steel",
  unavailable_malfunction: "bg-[#FCEBEB] text-signal",
};

const STATUS_LABEL = {
  available: "Available",
  requested: "Requested",
  borrowed: "Borrowed",
  unavailable_malfunction: "Malfunction",
};

export default function Search() {
  const [query, setQuery] = useState("");
  const [tools, setTools] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("list"); // "list" | "map"

  const runSearch = useCallback(async (q) => {
    setLoading(true);
    setError("");
    let request = supabase
      .from("tools")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(60);

    if (q.trim()) {
      request = request.textSearch("search_vector", q.trim(), { type: "websearch" });
    }

    const { data, error } = await request;
    if (error) {
      setError(error.message);
      setTools([]);
    } else {
      setTools(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  // Groups are pinned alongside tools on the map — helps evaluate which group
  // to join independent of any specific search (see docs/technical-design.md
  // -> Core Flows -> Search). Only fetched once, not re-run per keystroke.
  useEffect(() => {
    supabase
      .from("groups")
      .select("id, name, approx_lat, approx_lng")
      .then(({ data, error }) => {
        if (!error) setGroups(data ?? []);
      });
  }, []);

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-panelBorder bg-panel px-3 py-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="#B7BCC2" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ladder, drill bits, chain saw…"
              className="w-full bg-transparent font-mono text-xs text-steelLight outline-none placeholder:text-steelLight"
            />
          </div>
          <div className="flex flex-shrink-0 gap-0 rounded-lg bg-panel p-0.5">
            {[["list", "List"], ["map", "Map"]].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setView(val)}
                className={`rounded-md px-2.5 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${
                  view === val ? "bg-safety text-asphalt" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "map" && (
        <div className="h-[60vh] w-full">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>}>
            <ToolMap tools={tools} groups={groups} />
          </Suspense>
        </div>
      )}

      {view === "list" && (
      <div className="px-4 py-3.5">
        {loading && <p className="py-8 text-center text-sm text-muted">Searching…</p>}

        {!loading && error && (
          <p className="rounded-lg border border-[#F0C4C4] bg-[#FCEBEB] p-3 text-sm text-signal">{error}</p>
        )}

        {!loading && !error && tools.length === 0 && (
          <div className="py-16 text-center text-muted">
            <p className="text-sm">
              {query.trim() ? `Nothing matches "${query}" yet.` : "No tools listed yet — be the first."}
            </p>
            <Link to="/my-tools" className="mt-2 inline-block text-sm font-semibold text-racing">
              List a tool
            </Link>
          </div>
        )}

        <div className="space-y-2.5">
          {tools.map((tool) => (
            <Link
              key={tool.id}
              to={`/tool/${tool.id}`}
              className="flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3"
              style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
            >
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-asphalt text-safety">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <rect x="3" y="9" width="18" height="8" rx="1" />
                  <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold text-asphalt">{tool.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${STATUS_STYLE[tool.status] ?? ""}`}>
                    {STATUS_LABEL[tool.status] ?? tool.status}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted">{tool.profiles?.display_name ?? "Unknown"}</span>
                </div>
              </div>
              <span className={`flex-shrink-0 font-mono text-[12px] font-bold ${tool.monetize ? "text-[#B5602A]" : "text-[#3B7A3F]"}`}>
                {tool.monetize ? `$${tool.price}/${tool.price_duration_unit?.replace("_", " ") ?? "day"}` : "Free"}
              </span>
            </Link>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

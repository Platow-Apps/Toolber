import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import SearchTagline from "../components/SearchTagline";
import ToolCard from "../components/ToolCard";

// mapbox-gl is large (~2MB) — lazy-loaded so it's only fetched by people who
// actually switch to Map view, not everyone browsing the list.
const ToolMap = lazy(() => import("../components/ToolMap"));

// Remembers the visitor's last-picked List/Map view across visits and
// back-navigation (e.g. pin -> Tool Detail -> back should land back in Map,
// not reset to List) — without defaulting brand-new/anonymous visitors into
// a Mapbox load on every single Search visit. An explicit ?view=map deep
// link (from a "View on map" button elsewhere) always wins over this.
const VIEW_STORAGE_KEY = "toolber:searchView";

// search_vector is deliberately absent: it's the full lexeme vector for name +
// description + category, it's never rendered, and it was being pulled for
// every row on every keystroke.
const SELECT_COLUMNS =
  "id, name, category, description, status, monetize, price, price_duration_unit, for_sale, chest_id, photos, profiles(display_name, approx_lat, approx_lng, map_pin_hidden)";

const RESULT_LIMIT = 60;

export default function Search() {
  // "View on map" links from Tool Detail / Group Detail land here as
  // ?view=map&focusType=tool|group&focusId=... — open straight to that pin
  // instead of the default list view.
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const focusType = searchParams.get("focusType");
  const focusId = searchParams.get("focusId");
  // Memoised: this is a dependency of ToolMap's marker effect. Rebuilt inline it
  // would be a new identity on every render — i.e. every keystroke — which tore
  // down and re-created every marker and re-fired flyTo/togglePopup each time.
  const focus = useMemo(
    () => (focusType && focusId ? { type: focusType, id: focusId } : null),
    [focusType, focusId]
  );

  const [query, setQuery] = useState("");
  const [tools, setTools] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupsError, setGroupsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setViewState] = useState(() => {
    if (searchParams.get("view") === "map") return "map";
    try {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "map" || saved === "list") return saved;
    } catch {
      // localStorage unavailable (private browsing, etc.) — just fall through.
    }
    return "list";
  }); // "list" | "map"

  function setView(next) {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not critical if this fails — the choice just won't persist.
    }
  }

  // Monotonic id for the in-flight search. Debouncing alone doesn't prevent a
  // slow early query from landing after a fast later one and showing results
  // for a query the visitor has already moved on from.
  const searchSeq = useRef(0);

  const runSearch = useCallback(async (q) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    setError("");
    let request = supabase
      .from("tools")
      .select(SELECT_COLUMNS)
      // Paused listings are withdrawn by their owner — out of search and off
      // the map, but not deleted (0023_tool_management.sql).
      .eq("paused", false)
      .order("created_at", { ascending: false })
      .limit(RESULT_LIMIT);

    if (q.trim()) {
      request = request.textSearch("search_vector", q.trim(), { type: "websearch" });
    }

    const { data, error } = await request;
    if (seq !== searchSeq.current) return; // superseded by a newer query

    if (error) {
      setError(error.message);
      setTools([]);
    } else {
      setTools(data ?? []);
      // Logged after the debounce settles, so this is one event per query the
      // visitor actually finished typing, not one per keystroke.
      if (q.trim()) logEvent(userId, EVENTS.SEARCH_PERFORMED, { query: q.trim(), results: data?.length ?? 0 });
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const handle = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  // Groups are pinned alongside tools on the map — helps evaluate which group
  // to join independent of any specific search (see docs/technical-design.md
  // -> Core Flows -> Search). Only fetched once, not re-run per keystroke.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.from("groups").select("id, name, approx_lat, approx_lng");
      if (!mounted) return;
      if (error) {
        // Non-fatal — tools still plot. Say so rather than showing a map that
        // is silently missing every group pin.
        setGroupsError(error.message);
      } else {
        setGroups(data ?? []);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    // `grow`, not `min-h-full` — flex-grow with an auto basis, so the screen is
    // at least as tall as its content (list view scrolls) and otherwise expands
    // to fill the shell's content row (map view). See PublicLayout for why the
    // percentage version did not work.
    <div className="flex grow flex-col">
      <div className="flex-shrink-0 bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar>
          <SearchTagline />
        </BrandBar>
        <div className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#B7BCC2" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ladder, drill bits, chain saw…"
            className="w-full bg-transparent font-mono text-xs text-steelLight outline-none placeholder:text-steelLight placeholder:opacity-50"
          />
        </div>

        {/* Bolder, full-width toggle — the map is a real feature, not a
            buried option, so it gets the same visual weight as a tab bar
            rather than a small pill squeezed next to the search box. */}
        <div className="mt-2.5 flex gap-0 rounded-lg bg-panel p-0.5">
          {[
            [
              "list",
              "Browse",
              <>
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </>,
            ],
            [
              "map",
              "Map View",
              <>
                <path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </>,
            ],
          ].map(([val, label, icon]) => (
            <button
              key={val}
              type="button"
              aria-pressed={view === val}
              onClick={() => setView(val)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 font-condensed text-[0.812rem] font-bold uppercase tracking-wide ${
                view === val ? "bg-safety text-asphalt" : "text-steelLight"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                {icon}
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* List a Tool entry point — was previously only reachable via My
            Tools, which real user testing found not obvious at all. Same
            button, same place in the layout (directly below the view
            toggle), same style as My Tools' own "List Something" button —
            one visual identity for this action everywhere it appears. */}
        <Link
          to="/my-tools/new"
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-asphalt py-3 font-condensed text-[0.812rem] font-bold uppercase tracking-wide text-safety"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          List Something
        </Link>
      </div>

      {view === "map" && groupsError && (
        <p className="flex-shrink-0 bg-[#FCEBEB] px-4 py-2 text-xs text-signal">
          Group pins couldn’t be loaded: {groupsError}
        </p>
      )}

      {view === "map" && (
        // The inner absolute layer is what actually gives the map a definite
        // height: mapbox sizes its canvas from the container's own box, and a
        // `h-full` child of a flex item is exactly the percentage case that
        // does not resolve. `inset-0` against a positioned parent always does.
        <div className="relative min-h-0 w-full flex-1">
          <div className="absolute inset-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>}>
              <ToolMap tools={tools} groups={groups} focus={focus} />
            </Suspense>
          </div>
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
              List Something
            </Link>
          </div>
        )}

        <div className="space-y-2.5">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

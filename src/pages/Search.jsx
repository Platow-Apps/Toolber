import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import ToolCard from "../components/ToolCard";
import SearchNear from "../components/SearchNear";
import { resolveOrigin } from "../lib/searchOrigin";

// mapbox-gl is large (~2MB) — lazy-loaded so it's only fetched by people who
// actually switch to Map view, not everyone browsing the list.
const ToolMap = lazy(() => import("../components/ToolMap"));

// Remembers the visitor's last-picked List/Map view across visits and
// back-navigation (e.g. pin -> Tool Detail -> back should land back in Map,
// not reset to List) — without defaulting brand-new/anonymous visitors into
// a Mapbox load on every single Search visit. An explicit ?view=map deep
// link (from a "View on map" button elsewhere) always wins over this.
const VIEW_STORAGE_KEY = "toolber:searchView";

const RESULT_LIMIT = 60;

/**
 * search_tools() returns owner columns flat, because a SQL function cannot
 * return the nested shape PostgREST's embedded select does. ToolCard and
 * ToolMap both read tool.profiles.*, so the row is reassembled here rather
 * than teaching two components a second shape.
 */
function withOwner(row) {
  return {
    ...row,
    profiles: {
      display_name: row.owner_display_name,
      approx_lat: row.owner_approx_lat,
      approx_lng: row.owner_approx_lng,
      map_pin_hidden: row.owner_map_pin_hidden,
    },
  };
}

export default function Search() {
  // "View on map" links from Tool Detail / Group Detail land here as
  // ?view=map&focusType=tool|group&focusId=... — open straight to that pin
  // instead of the default list view.
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, profile } = useAuth();
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

  // Seeded from the URL, and written back to it below, so that clicking a
  // result and pressing Back returns to the same narrowed set rather than a
  // reset search — and so a filtered view can be linked to at all.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [tools, setTools] = useState([]);
  // Where distance is measured from: a place the person chose, else their own
  // approximate area, else nothing — in which case results stay newest-first.
  const [origin, setOrigin] = useState(() => resolveOrigin(null));
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

  // Filtered here rather than in Postgres: every group is already fetched once
  // for the map pins, and there are few enough of them that a round trip per
  // keystroke would cost more than it saves. Matches name, neighborhood, city
  // and zip, so "oakhill" and "94110" both find the same group.
  const matchingGroups = useMemo(() => {
    const typed = query.trim().toLowerCase();
    if (!typed) return groups;
    return groups.filter((group) =>
      [group.name, group.neighborhood_label, group.city, group.zip_code]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(typed))
    );
  }, [groups, query]);

  // Ordering happens in Postgres, not here (0042). Sorting the rows this
  // screen already has would only reorder the newest 60 the server picked by
  // recency -- the nearest tool might not be among them at all, which is the
  // whole problem once anyone is more than a town away.
  const runSearch = useCallback(async (q, from) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    setError("");

    const { data, error } = await supabase.rpc("search_tools", {
      p_query: q.trim() || null,
      p_lat: from?.lat ?? null,
      p_lng: from?.lng ?? null,
      p_limit: RESULT_LIMIT,
    });
    if (seq !== searchSeq.current) return; // superseded by a newer query

    if (error) {
      setError(error.message);
      setTools([]);
    } else {
      setTools((data ?? []).map(withOwner));
      // Logged after the debounce settles, so this is one event per query the
      // visitor actually finished typing, not one per keystroke.
      if (q.trim()) {
        logEvent(userId, EVENTS.SEARCH_PERFORMED, {
          query: q.trim(),
          results: data?.length ?? 0,
          // Whether proximity ordering was in play at all, which is the thing
          // worth knowing when reading these back.
          near: Boolean(from),
        });
      }
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const handle = setTimeout(() => runSearch(query, origin), 250);
    return () => clearTimeout(handle);
  }, [query, origin, runSearch]);

  // The profile arrives after the first render, so the default origin -- the
  // person's own area -- cannot be known at mount. Only fills a gap: a place
  // they chose themselves always wins, and is never overwritten here.
  useEffect(() => {
    setOrigin((current) => current ?? resolveOrigin(profile));
  }, [profile]);

  // Mirror the settled query into the URL. `replace` rather than push: a
  // history entry per keystroke would make Back walk backwards through the
  // typing instead of leaving the screen. The equality guard is what stops
  // this looping — writing the param re-renders, which re-runs this effect.
  useEffect(() => {
    const inUrl = searchParams.get("q") ?? "";
    const typed = query.trim();
    if (inUrl === typed) return;

    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (typed) next.set("q", typed);
      else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, searchParams, setSearchParams]);

  // Groups are pinned alongside tools on the map — helps evaluate which group
  // to join independent of any specific search (see docs/technical-design.md
  // -> Core Flows -> Search). Only fetched once, not re-run per keystroke.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("groups")
        .select("id, name, neighborhood_label, city, zip_code, approx_lat, approx_lng");
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
        <BrandBar />
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
          <SearchNear
            origin={origin}
            onChange={setOrigin}
            canUseHome={profile?.approx_lat != null && profile?.approx_lng != null}
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

      {/* A failed search used to be invisible here: the error only rendered in
          list view, so the map just showed no pins and looked like "nothing
          matched". Surface every error — see CLAUDE.md → Coding Standards. */}
      {view === "map" && error && (
        <p className="flex-shrink-0 bg-[#FCEBEB] px-4 py-2 text-xs text-signal">{error}</p>
      )}

      {view === "map" && groupsError && (
        <p className="flex-shrink-0 bg-[#FCEBEB] px-4 py-2 text-xs text-signal">
          Group pins couldn’t be loaded: {groupsError}
        </p>
      )}

      {/* Distinguish "no matches" from "something broke" — both looked
          identical on the map before. */}
      {view === "map" && !loading && !error && tools.length === 0 && (
        <p className="flex-shrink-0 bg-page px-4 py-2 text-center text-xs text-muted">
          {query.trim() ? `Nothing matches “${query}” yet.` : "No tools listed yet."}
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
              <ToolMap tools={tools} groups={groups} focus={focus} origin={origin} />
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

        {/* Groups were map-only, which made a young group effectively invisible:
            a group pin is the average of its members' approximate points and
            is withheld below three members, so a new group had no pin and no
            other place to be found either. In the list it is findable from the
            moment it exists. */}
        {!loading && matchingGroups.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              {matchingGroups.length} group{matchingGroups.length === 1 ? "" : "s"}
            </p>
            <div className="space-y-2">
              {matchingGroups.map((group) => (
                <Link
                  key={group.id}
                  to={`/groups/${group.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-cardBorder bg-white p-3"
                  style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#2878B8]/10">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#2878B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-asphalt">{group.name}</p>
                    <p className="truncate text-[0.688rem] text-muted">
                      {[group.neighborhood_label, group.city, group.zip_code].filter(Boolean).join(" · ") ||
                        "No location set"}
                    </p>
                  </div>
                  {!group.approx_lat && (
                    <span className="flex-shrink-0 rounded bg-[#EEECE8] px-1.5 py-0.5 font-mono text-[0.594rem] uppercase tracking-wide text-steel">
                      Not on map
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && tools.length === 0 && matchingGroups.length === 0 && (
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

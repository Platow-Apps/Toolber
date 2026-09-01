import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { useAuth } from "../contexts/AuthContext";
import PageHeader from "../components/PageHeader";
import ToolCard from "../components/ToolCard";

// Same columns ToolCard needs everywhere else. Deliberately no aggregate of
// any kind: no count of value, no "12 tools worth $4,000". A list of what
// someone lends is useful; a valuation of their garage is a target.
const TOOL_SELECT_COLUMNS =
  "id, name, category, status, monetize, price, price_duration_unit, for_sale, due_at, chest_id, photos";

const TOOL_LIMIT = 100;

/**
 * One neighbor's tools, together.
 *
 * Behind RequireAuth on purpose. Individual tools stay publicly searchable —
 * that has always been true and is not changed by this screen — but reading
 * off somebody's whole inventory should take a verified account. It is a
 * modest barrier and it costs a real neighbor nothing.
 */
export default function Chest() {
  const { id } = useParams();
  const { user } = useAuth();

  const [owner, setOwner] = useState(null);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isMe = user?.id === id;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data: ownerData, error: ownerErr } = await supabase
      .from("profiles")
      .select("id, display_name, chest_public")
      .eq("id", id)
      .single();

    if (ownerErr) {
      setError(ownerErr.message);
      setLoading(false);
      return;
    }
    setOwner(ownerData);

    // Your own chest is always visible to you, however the switch is set.
    if (!ownerData.chest_public && !(user?.id === id)) {
      setTools([]);
      setLoading(false);
      return;
    }

    const { data, error: toolsErr } = await supabase
      .from("tools")
      .select(TOOL_SELECT_COLUMNS)
      .eq("chest_id", id)
      // Same withdrawal rule as global search (0023_tool_management.sql) — a
      // paused listing is off the map and out of search, so it is off here too.
      .eq("paused", false)
      .order("created_at", { ascending: false })
      .limit(TOOL_LIMIT);

    if (toolsErr) setError(toolsErr.message);
    setTools(data ?? []);
    setLoading(false);
  }, [id, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    logEvent(user?.id ?? null, EVENTS.CHEST_VIEWED, { chest_id: id });
  }, [id, user?.id]);

  const name = owner?.display_name ?? "This neighbor";
  const hidden = owner && !owner.chest_public && !isMe;

  return (
    <div className="pb-6">
      <PageHeader title={isMe ? "My chest" : `${name}'s chest`} />

      <div className="px-4 py-4">
        {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

        {!loading && error && (
          <p className="rounded-lg border border-[#F0C4C4] bg-[#FCEBEB] p-3 text-sm text-signal">{error}</p>
        )}

        {!loading && hidden && (
          <p className="py-16 text-center text-sm text-muted">
            {name} lists tools individually rather than as a collection. You can still find them
            through search.
          </p>
        )}

        {!loading && !hidden && !error && tools.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">
            {isMe ? "You haven't listed anything yet." : `${name} has nothing listed right now.`}
          </p>
        )}

        {!loading && !hidden && tools.length > 0 && (
          <>
            <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              {tools.length} tool{tools.length === 1 ? "" : "s"}
            </p>
            <div className="space-y-2.5">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} showOwner={false} />
              ))}
            </div>

            {!isMe && (
              <p className="mt-4 text-[0.688rem] leading-relaxed text-muted">
                Each of these is its own request — approving one doesn't approve the rest.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

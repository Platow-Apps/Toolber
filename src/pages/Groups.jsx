import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { distanceMiles, formatDistance } from "../lib/geo";
import { EVENTS, logEvent } from "../lib/analytics";
import BrandBar from "../components/BrandBar";

// Neither list is paginated in the UI yet; the cap at least keeps a large
// instance from fetching every group and every membership row at once.
const PAGE_SIZE = 200;

const MEMBERSHIP_PILL = {
  pending: "bg-[#FCF1D6] text-[#8A6300]",
  approved: "bg-[#E9F3E9] text-[#2E6B2E]",
};

function GroupIcon({ className }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
      <path d="M16 14.2a4 4 0 0 1 4.5 4" />
    </svg>
  );
}

function MyGroups({ user }) {
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("group_memberships")
        .select("id, status, group:groups(id, name, neighborhood_label, city)")
        .eq("profile_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!mounted) return;
      if (error) setError(error.message);
      else setMemberships(data ?? []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user.id]);

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;

  if (error) return <p className="py-8 text-center text-sm text-signal">{error}</p>;

  if (memberships.length === 0) {
    return <p className="py-12 text-center text-sm text-muted">You haven't joined any groups yet — try Find a Group.</p>;
  }

  return (
    <div className="space-y-2.5">
      {memberships.map((m) => (
        <Link
          key={m.id}
          to={`/groups/${m.group.id}`}
          className="flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-asphalt text-racing">
            <GroupIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.844rem] font-bold text-asphalt">{m.group?.name ?? "Group"}</p>
            <p className="truncate text-[0.688rem] text-muted">
              {[m.group?.neighborhood_label, m.group?.city].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          {m.status === "pending" && (
            <span className={`flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${MEMBERSHIP_PILL.pending}`}>
              Request Pending
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

function FindGroup({ user, profile }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joiningId, setJoiningId] = useState(null);
  const [error, setError] = useState("");
  const [codeMsg, setCodeMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    // invite_code intentionally not selected -- it's column-grant-restricted
    // now (0014_security_fixes.sql, SEC-2). Requesting to join a group found
    // here goes through request_to_join_group(group_id), not the code.
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, neighborhood_label, city, zip_code, admin_id, approx_lat, approx_lng, group_memberships(profile_id, status)")
      .limit(PAGE_SIZE);
    if (error) setError(error.message);
    else setGroups(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function requestToJoin(group) {
    setJoiningId(group.id);
    setError("");
    const { error } = await supabase.rpc("request_to_join_group", { p_group_id: group.id });
    setJoiningId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.GROUP_JOINED, { group_id: group.id });
    await load();
  }

  async function joinByCode(e) {
    e.preventDefault();
    setError("");
    setCodeMsg("");
    if (!inviteCode.trim()) return;
    const code = inviteCode.trim().toUpperCase();
    const { error } = await supabase.rpc("join_group", { p_invite_code: code });
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.GROUP_JOINED, { invite_code: code });
    setInviteCode("");
    setCodeMsg("Request sent.");
    await load();
  }

  const q = query.trim().toLowerCase();
  const results = groups
    .map((g) => ({
      ...g,
      distance: distanceMiles(profile?.approx_lat, profile?.approx_lng, g.approx_lat, g.approx_lng),
      memberCount: (g.group_memberships ?? []).filter((m) => m.status === "approved").length,
      myMembership: (g.group_memberships ?? []).find((m) => m.profile_id === user.id) ?? null,
    }))
    .filter((g) => (q ? [g.name, g.city, g.zip_code, g.neighborhood_label].some((f) => f?.toLowerCase().includes(q)) : true))
    .sort((a, b) => {
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-cardBorder bg-white px-3 py-2.5">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#8B8D89" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="name, neighborhood, city, zip…"
          className="w-full bg-transparent text-sm text-asphalt outline-none placeholder:text-muted"
        />
      </div>

      <form onSubmit={joinByCode} className="mb-4 flex gap-1.5">
        <input
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="Have an invite code?"
          className="flex-1 rounded-lg border border-cardBorder bg-white px-3 py-2 text-sm text-asphalt outline-none"
        />
        <button type="submit" className="rounded-lg border border-cardBorder bg-white px-3 py-2 text-[0.688rem] font-bold uppercase text-ink">
          Join
        </button>
      </form>
      {codeMsg && <p className="mb-3 text-[0.688rem] text-[#2E6B2E]">{codeMsg}</p>}
      {error && <p className="mb-3 text-sm text-signal">{error}</p>}

      {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
      {!loading && results.length === 0 && <p className="py-12 text-center text-sm text-muted">No groups found.</p>}

      <div className="space-y-2.5">
        {results.map((g) => (
          <div
            key={g.id}
            className="rounded-lg border border-cardBorder bg-white p-3"
            style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
          >
            <div className="flex items-start justify-between gap-2">
              <Link to={`/groups/${g.id}`} className="min-w-0 flex-1">
                <p className="truncate text-[0.844rem] font-bold text-asphalt">{g.name}</p>
                <p className="truncate text-[0.688rem] text-muted">
                  {[g.neighborhood_label, g.city].filter(Boolean).join(" · ") || "—"}
                  {g.memberCount > 0 ? ` · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : ""}
                </p>
                {g.distance != null && <p className="mt-0.5 text-[0.656rem] text-racing">{formatDistance(g.distance)}</p>}
              </Link>
              <div className="flex-shrink-0">
                {g.admin_id === user.id && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${MEMBERSHIP_PILL.approved}`}>
                    Admin
                  </span>
                )}
                {g.admin_id !== user.id && g.myMembership?.status === "pending" && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${MEMBERSHIP_PILL.pending}`}>
                    Request Pending
                  </span>
                )}
                {g.admin_id !== user.id && g.myMembership?.status === "approved" && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${MEMBERSHIP_PILL.approved}`}>
                    Member
                  </span>
                )}
                {g.admin_id !== user.id && !g.myMembership && (
                  <button
                    type="button"
                    onClick={() => requestToJoin(g)}
                    disabled={joiningId === g.id}
                    className="rounded-md bg-asphalt px-2.5 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                  >
                    {joiningId === g.id ? "…" : "Request to Join"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Groups() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState("mine");

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3 pt-4">
        <BrandBar />
        <div className="mb-3 flex items-center justify-end">
          <Link
            to="/groups/new"
            className="flex items-center gap-1 rounded-md bg-safety px-2.5 py-1.5 font-mono text-[0.656rem] font-bold uppercase tracking-wide text-asphalt"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create New
          </Link>
        </div>
        <div className="flex gap-0 rounded-lg bg-panel p-0.5">
          {[["mine", "My Groups"], ["find", "Find a Group"]].map(([val, label]) => (
            <button
              key={val}
              type="button"
              aria-pressed={tab === val}
              onClick={() => setTab(val)}
              className={`flex-1 rounded-md py-1.5 font-mono text-[0.688rem] font-semibold uppercase tracking-wide ${
                tab === val ? "bg-safety text-asphalt" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3.5">{tab === "mine" ? <MyGroups user={user} /> : <FindGroup user={user} profile={profile} />}</div>
    </div>
  );
}

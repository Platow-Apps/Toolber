import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const TOOL_SELECT_COLUMNS =
  "id, name, category, status, monetize, price, price_duration_unit, crib_id, profiles(display_name)";

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

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState(null);
  const [myMembership, setMyMembership] = useState(null);
  const [memberCount, setMemberCount] = useState(0);
  const [tools, setTools] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [decidingId, setDecidingId] = useState(null);
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  const isAdmin = group?.admin_id === user.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data: groupData, error: groupErr } = await supabase.from("groups").select("*").eq("id", id).single();
    if (groupErr) {
      setError(groupErr.message);
      setLoading(false);
      return;
    }
    setGroup(groupData);
    setLocationDraft(groupData.default_exchange_location ?? "");

    const [{ data: memberships }, pendingResult] = await Promise.all([
      supabase.from("group_memberships").select("id, profile_id, status").eq("group_id", id),
      groupData.admin_id === user.id
        ? supabase
            .from("group_memberships")
            .select("id, requested_at, profiles(display_name)")
            .eq("group_id", id)
            .eq("status", "pending")
            .order("requested_at", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);

    const approvedIds = (memberships ?? []).filter((m) => m.status === "approved").map((m) => m.profile_id);
    setMemberCount(approvedIds.length);
    setMyMembership((memberships ?? []).find((m) => m.profile_id === user.id) ?? null);
    setPending(pendingResult.data ?? []);

    if (approvedIds.length > 0) {
      const { data: toolData } = await supabase
        .from("tools")
        .select(TOOL_SELECT_COLUMNS)
        .in("crib_id", approvedIds)
        .order("created_at", { ascending: false });
      setTools(toolData ?? []);
    } else {
      setTools([]);
    }

    setLoading(false);
  }, [id, user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function requestToJoin() {
    if (!group) return;
    setJoining(true);
    setError("");
    const { error } = await supabase.rpc("join_group", { p_invite_code: group.invite_code });
    setJoining(false);
    if (error) {
      setError(error.message);
      return;
    }
    await supabase.from("events").insert({ profile_id: user.id, event_type: "group_joined", metadata: { group_id: group.id } });
    await load();
  }

  async function decide(membershipId, approve) {
    setDecidingId(membershipId);
    const { error } = await supabase.rpc("decide_group_membership", { p_membership_id: membershipId, p_approve: approve });
    setDecidingId(null);
    if (!error) await load();
  }

  async function saveLocation() {
    setSavingLocation(true);
    const { error } = await supabase
      .from("groups")
      .update({ default_exchange_location: locationDraft.trim() || null })
      .eq("id", id);
    setSavingLocation(false);
    if (!error) {
      setGroup((g) => ({ ...g, default_exchange_location: locationDraft.trim() || null }));
      setEditingLocation(false);
    }
  }

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
        <p className="truncate font-condensed text-base font-bold uppercase tracking-wide text-safety">{group?.name ?? "Group"}</p>
      </div>

      <div className="px-4 py-4">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && error && <p className="mb-3 text-sm text-signal">{error}</p>}

        {!loading && group && (
          <>
            <div className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5">
              <p className="mb-0.5 text-[13px] text-ink">
                {[group.neighborhood_label, group.city, group.zip_code].filter(Boolean).join(" · ") || "No location details yet"}
              </p>
              <p className="mb-3 text-[11px] text-muted">
                {memberCount} member{memberCount === 1 ? "" : "s"}
                {isAdmin ? " · you're the admin" : myMembership?.status === "approved" ? " · you're a member" : ""}
              </p>

              <div className="mb-1 flex items-center justify-between">
                <p className="font-mono text-[9.5px] uppercase tracking-wide text-muted">Default exchange spot</p>
                {isAdmin && !editingLocation && (
                  <button type="button" onClick={() => setEditingLocation(true)} className="text-[10.5px] font-semibold text-racing">
                    Edit
                  </button>
                )}
              </div>
              {editingLocation ? (
                <div className="flex gap-1.5">
                  <input
                    value={locationDraft}
                    onChange={(e) => setLocationDraft(e.target.value)}
                    className="flex-1 rounded-lg border border-cardBorder bg-white px-2.5 py-1.5 text-[12.5px] text-asphalt outline-none"
                  />
                  <button
                    type="button"
                    onClick={saveLocation}
                    disabled={savingLocation}
                    className="rounded-md bg-asphalt px-2.5 py-1.5 text-[11px] font-bold text-safety disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <p className="text-[13px] font-semibold text-asphalt">{group.default_exchange_location || "Not set"}</p>
              )}

              {(isAdmin || myMembership?.status === "approved") && (
                <p className="mt-3 border-t border-cardBorder pt-2.5 font-mono text-[10.5px] text-muted">
                  Invite code: <span className="font-bold text-asphalt">{group.invite_code}</span>
                </p>
              )}
            </div>

            {!isAdmin && !myMembership && (
              <button
                type="button"
                onClick={requestToJoin}
                disabled={joining}
                className="mb-4 w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
              >
                {joining ? "Requesting…" : "Request to Join"}
              </button>
            )}
            {!isAdmin && myMembership?.status === "pending" && (
              <p className="mb-4 rounded-lg bg-[#FCF1D6] py-3 text-center text-sm font-semibold text-[#8A6300]">Request Pending</p>
            )}

            {isAdmin && (
              <div className="mb-5">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted">Admin inbox</p>
                {pending.length === 0 && <p className="mb-2 text-sm text-muted">No pending requests.</p>}
                <div className="space-y-2">
                  {pending.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
                      <p className="text-[12.5px] text-asphalt">
                        <b>{p.profiles?.display_name ?? "Someone"}</b> wants to join
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={decidingId === p.id}
                          onClick={() => decide(p.id, true)}
                          className="rounded-md bg-asphalt px-2.5 py-1.5 text-[11px] font-bold text-safety disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={decidingId === p.id}
                          onClick={() => decide(p.id, false)}
                          className="rounded-md border border-steelLight px-2.5 py-1.5 text-[11px] font-bold text-ink disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted">Tools in this group</p>
            {tools.length === 0 && <p className="py-6 text-center text-sm text-muted">No tools listed by this group's members yet.</p>}
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
          </>
        )}
      </div>
    </div>
  );
}

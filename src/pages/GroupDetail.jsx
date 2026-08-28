import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { describeJoinResult, joinCreatedRequest } from "../lib/joinStatus";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import ToolCard from "../components/ToolCard";

const TOOL_SELECT_COLUMNS =
  "id, name, category, status, monetize, price, price_duration_unit, for_sale, due_at, chest_id, photos, profiles(display_name)";

// invite_code and default_exchange_location aren't in this list on purpose --
// they're column-grant-restricted now (0014_security_fixes.sql, SEC-2) and
// only readable through get_group_invite_details(), same "checked RPC only"
// shape as pickup_location.
const GROUP_SELECT_COLUMNS = "id, name, neighborhood_label, city, zip_code, admin_id, approx_lat, approx_lng, created_at";

// A group's tool list is capped: `.in("chest_id", …)` is a URL-encoded id list,
// which stops being viable at a few hundred members.
const MEMBER_LIMIT = 200;
const TOOL_LIMIT = 100;

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState(null);
  const [inviteDetails, setInviteDetails] = useState(null); // { invite_code, default_exchange_location } — admin/approved-member only
  const [myMembership, setMyMembership] = useState(null);
  const [members, setMembers] = useState([]); // full membership rows, admin-only (for the Members list below)
  const [memberCount, setMemberCount] = useState(0);
  const [tools, setTools] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [messagingId, setMessagingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  const isAdmin = group?.admin_id === user.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data: groupData, error: groupErr } = await supabase.from("groups").select(GROUP_SELECT_COLUMNS).eq("id", id).single();
    if (groupErr) {
      setError(groupErr.message);
      setLoading(false);
      return;
    }
    setGroup(groupData);

    const [{ data: memberships, error: membersErr }, pendingResult] = await Promise.all([
      supabase
        .from("group_memberships")
        .select("id, profile_id, status, profiles(display_name)")
        .eq("group_id", id)
        .limit(MEMBER_LIMIT),
      groupData.admin_id === user.id
        ? supabase
            .from("group_memberships")
            .select("id, requested_at, profiles(display_name)")
            .eq("group_id", id)
            .eq("status", "pending")
            .order("requested_at", { ascending: true })
            .limit(MEMBER_LIMIT)
        : Promise.resolve({ data: [] }),
    ]);

    if (membersErr) setError(membersErr.message);

    const approvedIds = (memberships ?? []).filter((m) => m.status === "approved").map((m) => m.profile_id);
    setMemberCount(approvedIds.length);
    const mine = (memberships ?? []).find((m) => m.profile_id === user.id) ?? null;
    setMyMembership(mine);
    setPending(pendingResult.data ?? []);
    // Full member list (view/message/remove) is admin-only for now, per the
    // explicit request that framed this as an admin capability.
    setMembers(
      groupData.admin_id === user.id
        ? (memberships ?? []).filter((m) => m.status === "approved" && m.profile_id !== user.id)
        : []
    );

    // invite_code / default_exchange_location: RPC-gated to the admin or an
    // approved member (see 0014_security_fixes.sql, SEC-2) — a plain select
    // on groups no longer returns them at all.
    if (groupData.admin_id === user.id || mine?.status === "approved") {
      const { data: details } = await supabase.rpc("get_group_invite_details", { p_group_id: id });
      const row = details?.[0] ?? null;
      setInviteDetails(row);
      setLocationDraft(row?.default_exchange_location ?? "");
    } else {
      setInviteDetails(null);
    }

    if (approvedIds.length > 0) {
      const { data: toolData, error: toolErr } = await supabase
        .from("tools")
        .select(TOOL_SELECT_COLUMNS)
        .in("chest_id", approvedIds)
        // Same withdrawal rule as global search (0023_tool_management.sql).
        .eq("paused", false)
        .order("created_at", { ascending: false })
        .limit(TOOL_LIMIT);
      if (toolErr) setError(toolErr.message);
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
    // Discovered via this page, not an out-of-band code -- see
    // request_to_join_group() in 0014_security_fixes.sql (SEC-2).
    const { data: status, error } = await supabase.rpc("request_to_join_group", { p_group_id: group.id });
    setJoining(false);
    if (error) {
      setError(error.message);
      return;
    }
    // The RPC returns what actually happened rather than a row id that was
    // NULL on conflict, so a repeat or previously-denied join no longer reads
    // as success (audit LOGIC-5).
    setNotice(describeJoinResult(status));
    if (joinCreatedRequest(status)) {
      await logEvent(user.id, EVENTS.GROUP_JOINED, { group_id: group.id });
    }
    await load();
  }

  async function leaveGroup() {
    setLeaving(true);
    setError("");
    const { error } = await supabase.rpc("leave_group", { p_group_id: group.id });
    setLeaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate("/groups", { replace: true });
  }

  async function decide(membershipId, approve) {
    setDecidingId(membershipId);
    setError("");
    const { error } = await supabase.rpc("decide_group_membership", { p_membership_id: membershipId, p_approve: approve });
    setDecidingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.GROUP_MEMBERSHIP_DECIDED, {
      membership_id: membershipId,
      approved: approve,
    });
    await load();
  }

  // Any admin can message any member of their group at any time (0019_general_
  // messaging.sql) -- doesn't require any shared borrow history.
  async function messageMember(profileId) {
    setMessagingId(profileId);
    setError("");
    const { data: conversationId, error } = await supabase.rpc("start_conversation", { p_other_user_id: profileId });
    setMessagingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(`/messages/${conversationId}`);
  }

  async function removeMember(membershipId) {
    setRemovingId(membershipId);
    setError("");
    const { error } = await supabase.rpc("remove_group_member", { p_membership_id: membershipId });
    setRemovingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await load();
  }

  async function saveLocation() {
    setSavingLocation(true);
    setError("");
    const next = locationDraft.trim() || null;
    const { error } = await supabase
      .from("groups")
      .update({ default_exchange_location: next })
      .eq("id", id);
    setSavingLocation(false);
    if (error) {
      setError(error.message);
      return;
    }
    setInviteDetails((d) => (d ? { ...d, default_exchange_location: next } : d));
    setEditingLocation(false);
  }

  return (
    <div className="pb-6">
      <div className="bg-asphalt px-4 pt-4">
        <BrandBar />
      </div>
      <div className="flex items-center gap-2.5 bg-asphalt px-4 py-3.5">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
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
              <div className="mb-0.5 flex items-center gap-2">
                <p className="text-[0.812rem] text-ink">
                  {[group.neighborhood_label, group.city, group.zip_code].filter(Boolean).join(" · ") || "No location details yet"}
                </p>
                {group.approx_lat != null && group.approx_lng != null && (
                  <Link
                    to={`/?view=map&focusType=group&focusId=${group.id}`}
                    className="flex flex-shrink-0 items-center gap-1 text-[0.688rem] font-semibold text-racing"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                      <path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                    View on map
                  </Link>
                )}
              </div>
              <p className="mb-3 text-[0.688rem] text-muted">
                {memberCount} member{memberCount === 1 ? "" : "s"}
                {isAdmin ? " · you're the admin" : myMembership?.status === "approved" ? " · you're a member" : ""}
              </p>

              {(isAdmin || myMembership?.status === "approved") && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">Default exchange spot</p>
                    {isAdmin && !editingLocation && (
                      <button type="button" onClick={() => setEditingLocation(true)} className="text-[0.656rem] font-semibold text-racing">
                        Edit
                      </button>
                    )}
                  </div>
                  {editingLocation ? (
                    <div className="flex gap-1.5">
                      <input
                        value={locationDraft}
                        onChange={(e) => setLocationDraft(e.target.value)}
                        className="flex-1 rounded-lg border border-cardBorder bg-white px-2.5 py-1.5 text-[0.781rem] text-asphalt outline-none"
                      />
                      <button
                        type="button"
                        onClick={saveLocation}
                        disabled={savingLocation}
                        className="rounded-md bg-asphalt px-2.5 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <p className="text-[0.812rem] font-semibold text-asphalt">{inviteDetails?.default_exchange_location || "Not set"}</p>
                  )}

                  <p className="mt-3 border-t border-cardBorder pt-2.5 font-mono text-[0.656rem] text-muted">
                    Invite code: <span className="font-bold text-asphalt">{inviteDetails?.invite_code}</span>
                  </p>
                </>
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

            {notice && <p className="mb-4 rounded-lg bg-asphalt/5 p-2.5 text-center text-sm text-ink">{notice}</p>}

            {/* Membership used to be a one-way door — there was no DELETE policy
                on group_memberships at all, so a member could never leave
                (audit RLS-2). The admin can't: it would orphan the group. */}
            {!isAdmin && myMembership?.status === "approved" && (
              <button
                type="button"
                onClick={leaveGroup}
                disabled={leaving}
                className="mb-4 w-full rounded-lg border border-steelLight py-2.5 font-condensed text-[0.812rem] font-bold uppercase tracking-wide text-ink disabled:opacity-50"
              >
                {leaving ? "Leaving…" : "Leave Group"}
              </button>
            )}

            {isAdmin && (
              <div className="mb-5">
                <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Admin inbox</p>
                {pending.length === 0 && <p className="mb-2 text-sm text-muted">No pending requests.</p>}
                <div className="space-y-2">
                  {pending.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
                      <p className="text-[0.781rem] text-asphalt">
                        <b>{p.profiles?.display_name ?? "Someone"}</b> wants to join
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={decidingId === p.id}
                          onClick={() => decide(p.id, true)}
                          className="rounded-md bg-asphalt px-2.5 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={decidingId === p.id}
                          onClick={() => decide(p.id, false)}
                          className="rounded-md border border-steelLight px-2.5 py-1.5 text-[0.688rem] font-bold text-ink disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="mb-5">
                <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                  Members {members.length > 0 ? `(${members.length})` : ""}
                </p>
                {members.length === 0 && <p className="mb-2 text-sm text-muted">No other approved members yet.</p>}
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border border-cardBorder bg-white p-3">
                      <p className="text-[0.781rem] font-semibold text-asphalt">{m.profiles?.display_name ?? "Someone"}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={messagingId === m.profile_id}
                          onClick={() => messageMember(m.profile_id)}
                          className="rounded-md bg-asphalt px-2.5 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                        >
                          {messagingId === m.profile_id ? "…" : "Message"}
                        </button>
                        <button
                          type="button"
                          disabled={removingId === m.id}
                          onClick={() => removeMember(m.id)}
                          className="rounded-md border border-steelLight px-2.5 py-1.5 text-[0.688rem] font-bold text-ink disabled:opacity-50"
                        >
                          {removingId === m.id ? "…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Tools in this group</p>
            {tools.length === 0 && <p className="py-6 text-center text-sm text-muted">No tools listed by this group's members yet.</p>}
            <div className="space-y-2.5">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

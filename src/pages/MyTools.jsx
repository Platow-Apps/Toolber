import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { formatDueDate, REQUEST_STATE_STYLE } from "../lib/toolStatus";
import { removeToolPhotos } from "../lib/photos";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import ToolCard from "../components/ToolCard";
import ToolManageMenu from "../components/ToolManageMenu";
import ReportUserButton from "../components/ReportUserButton";
import PushNudge from "../components/PushNudge";

const PAGE_SIZE = 100;

function Listings({ user }) {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingOn, setActingOn] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  // tool id -> the id of the approved request holding it, so "Mark returned"
  // can be offered here rather than only on the Requests tab. A return is an
  // event on the borrow request, and this screen only lists tools.
  const [loanByTool, setLoanByTool] = useState({});

  const load = useCallback(async () => {
    const [{ data, error }, { data: loans }] = await Promise.all([
      supabase
        .from("tools")
        .select("id, name, status, paused, monetize, price, price_duration_unit, for_sale, due_at, photos")
        .eq("chest_id", user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("borrow_requests")
        .select("id, tool_id")
        .eq("lender_id", user.id)
        .eq("status", "approved")
        .limit(PAGE_SIZE),
    ]);
    if (error) setError(error.message);
    else setTools(data ?? []);
    setLoanByTool(Object.fromEntries((loans ?? []).map((l) => [l.tool_id, l.id])));
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePause(tool, paused) {
    setActingOn(tool.id);
    setError("");
    const { error } = await supabase.from("tools").update({ paused }).eq("id", tool.id);
    setActingOn(null);
    if (error) {
      setError(error.message);
      return;
    }
    setTools((prev) => prev.map((t) => (t.id === tool.id ? { ...t, paused } : t)));
    await logEvent(user.id, paused ? EVENTS.TOOL_PAUSED : EVENTS.TOOL_RESUMED, { tool_id: tool.id });
  }

  async function markReturned(tool) {
    const requestId = loanByTool[tool.id];
    if (!requestId) return;
    setActingOn(tool.id);
    setError("");
    const { error } = await supabase.rpc("complete_borrow_request", { p_request_id: requestId });
    setActingOn(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.BORROW_COMPLETED, { request_id: requestId, tool_id: tool.id });
    // Refetch rather than patching locally: the tool's next status is
    // recomputed server-side and may be 'requested', not 'available', if
    // someone else is already waiting on it (0024's refresh_tool_state).
    await load();
  }

  async function deleteTool(tool) {
    setActingOn(tool.id);
    setError("");
    // Guarded server-side: delete_tool() refuses while a pending or approved
    // request exists, and hands back the photo paths so the Storage objects
    // can be cleaned up (0023_tool_management.sql).
    const { data: photoPaths, error } = await supabase.rpc("delete_tool", { p_tool_id: tool.id });
    setActingOn(null);
    if (error) {
      setError(error.message);
      return;
    }
    setTools((prev) => prev.filter((t) => t.id !== tool.id));
    await removeToolPhotos(photoPaths);
    await logEvent(user.id, EVENTS.TOOL_DELETED, { tool_id: tool.id });
  }

  return (
    <>
      <Link
        to="/my-tools/new"
        className="mb-3.5 flex w-full items-center justify-center gap-2 rounded-lg bg-asphalt py-3 font-condensed text-[0.812rem] font-bold uppercase tracking-wide text-safety"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        List Something
      </Link>

      {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
      {error && <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2.5 text-sm text-signal">{error}</p>}
      {!loading && !error && tools.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">Nothing listed yet — add your first tool above.</p>
      )}

      <div className="space-y-2.5">
        {/* No opacity on the per-tool wrapper: it contains the manage menu, and
            an opacity below 1 would create a stacking context that traps the
            open dropdown inside the card. ToolCard fades its own content. */}
        {tools.map((tool) => (
          <div key={tool.id}>
            <ToolCard
              tool={tool}
              showOwner={false}
              dimmed={tool.paused}
              action={
                <ToolManageMenu
                  tool={tool}
                  busy={actingOn === tool.id}
                  onReturn={loanByTool[tool.id] ? () => markReturned(tool) : null}
                  onTogglePause={(paused) => togglePause(tool, paused)}
                  onDelete={() => deleteTool(tool)}
                  confirmingDelete={confirmingDeleteId === tool.id}
                  onConfirmingDeleteChange={(on) => setConfirmingDeleteId(on ? tool.id : null)}
                />
              }
            />
            {/* The card already says "On lend until <date>", so this is just
                the action — same placement and type scale as the paused note
                below it, but styled as a control rather than a label. Also in
                the ⋮ menu; this is the version you can reach without opening
                anything. */}
            {loanByTool[tool.id] && (
              <button
                type="button"
                onClick={() => markReturned(tool)}
                disabled={actingOn === tool.id}
                className="mt-0.5 pl-3 font-mono text-[0.594rem] font-bold uppercase tracking-wide text-racing underline disabled:opacity-50"
              >
                {actingOn === tool.id ? "Marking returned…" : "Mark returned"}
              </button>
            )}
            {tool.paused && (
              <p className="mt-0.5 pl-3 font-mono text-[0.594rem] uppercase tracking-wide text-muted">
                Paused — hidden from search
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Requests({ user }) {
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [contacts, setContacts] = useState({}); // request id -> {display_name, email, phone}
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState(null);
  const [error, setError] = useState("");

  const [denyingId, setDenyingId] = useState(null);
  const [approveDays, setApproveDays] = useState({}); // request id -> owner-adjusted length
  const [denyReason, setDenyReason] = useState("");
  const [completingId, setCompletingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: inData, error: inErr }, { data: outData, error: outErr }] = await Promise.all([
      supabase
        .from("borrow_requests")
        .select("id, status, borrower_id, wants_instruction, requested_days, due_at, requested_at, denial_reason, tool:tools(name), borrower:profiles!borrow_requests_borrower_id_fkey(display_name)")
        .eq("lender_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("borrow_requests")
        .select("id, status, lender_id, requested_days, due_at, requested_at, denial_reason, tool:tools(name), lender:profiles!borrow_requests_lender_id_fkey(display_name)")
        .eq("borrower_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(PAGE_SIZE),
    ]);
    setError(inErr?.message ?? outErr?.message ?? "");
    setIncoming(inData ?? []);
    setOutgoing(outData ?? []);
    setLoading(false);

    // Contact reveal — same rule as pickup location, but from the owner's
    // side: once a request is approved, the owner can also reach the
    // borrower to arrange a time. Fetched for every approved request on
    // either side in one pass rather than per-card.
    const approved = [...(inData ?? []), ...(outData ?? [])].filter((r) => r.status === "approved");
    if (approved.length > 0) {
      const results = await Promise.all(
        approved.map((r) => supabase.rpc("get_borrow_contact", { p_request_id: r.id }).then(({ data }) => [r.id, data?.[0] ?? null]))
      );
      setContacts(Object.fromEntries(results));
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(requestId, approve, reason, days) {
    setActingOn(requestId);
    setError("");
    const { error } = approve
      ? await supabase.rpc("approve_borrow_request", { p_request_id: requestId, p_days: days ? Number(days) : null })
      : await supabase.rpc("deny_borrow_request", { p_request_id: requestId, p_reason: reason || null });
    setActingOn(null);
    if (error) {
      // Previously silent: a rejected approval left the button looking inert.
      setError(error.message);
      return;
    }
    await logEvent(user.id, approve ? EVENTS.BORROW_APPROVED : EVENTS.BORROW_DENIED, {
      request_id: requestId,
    });
    setDenyingId(null);
    setDenyReason("");
    await load();
  }

  function startDeny(requestId) {
    setDenyingId(requestId);
    setDenyReason("");
  }

  async function cancelRequest(requestId) {
    setCancellingId(requestId);
    setError("");
    const { error } = await supabase.rpc("cancel_borrow_request", { p_request_id: requestId });
    setCancellingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.BORROW_CANCELLED, { request_id: requestId });
    await load();
  }

  async function markReturned(requestId) {
    setCompletingId(requestId);
    setError("");
    const { error } = await supabase.rpc("complete_borrow_request", { p_request_id: requestId });
    setCompletingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.BORROW_COMPLETED, { request_id: requestId });
    await load();
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;

  return (
    <>
      {error && <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2.5 text-sm text-signal">{error}</p>}
      <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Incoming</p>
      {incoming.length === 0 && <p className="mb-4 text-sm text-muted">No requests on your tools yet.</p>}
      <div className="mb-5 space-y-2">
        {incoming.map((r) => (
          <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
            <p className="mb-1 text-[0.781rem] leading-snug text-asphalt">
              <b>{r.borrower?.display_name ?? "Someone"}</b> wants to borrow your <b>{r.tool?.name}</b>
            </p>
            {r.wants_instruction && <p className="mb-1.5 text-[0.688rem] text-muted">Asked for a quick walkthrough</p>}
            {r.status === "pending" && denyingId === r.id ? (
              <div className="mt-1.5">
                <textarea
                  value={denyReason}
                  onChange={(e) => setDenyReason(e.target.value)}
                  rows={2}
                  placeholder="Optional: let them know why (they'll see this)"
                  className="mb-1.5 w-full resize-none rounded-md border border-cardBorder bg-white px-2 py-1.5 text-[0.719rem] text-asphalt outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={actingOn === r.id}
                    onClick={() => decide(r.id, false, denyReason)}
                    className="rounded-md bg-asphalt px-3 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                  >
                    {actingOn === r.id ? "…" : "Confirm Deny"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDenyingId(null)}
                    className="rounded-md border border-steelLight px-3 py-1.5 text-[0.688rem] font-bold text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : r.status === "pending" ? (
              <div className="mt-1.5">
                <label className="mb-1.5 flex items-center gap-1.5 text-[0.688rem] text-muted">
                  Lend for
                  <input
                    type="number"
                    min="1"
                    max="365"
                    aria-label="Days to lend for"
                    value={approveDays[r.id] ?? r.requested_days ?? ""}
                    onChange={(e) => setApproveDays((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    className="w-14 rounded-md border border-cardBorder bg-white px-1.5 py-1 text-center text-[0.719rem] text-asphalt outline-none"
                  />
                  days
                </label>
                <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={actingOn === r.id}
                  onClick={() => decide(r.id, true, null, approveDays[r.id] ?? r.requested_days)}
                  className="rounded-md bg-asphalt px-3 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actingOn === r.id}
                  onClick={() => startDeny(r.id)}
                  className="rounded-md border border-steelLight px-3 py-1.5 text-[0.688rem] font-bold text-ink disabled:opacity-50"
                >
                    Deny
                  </button>
                </div>
              </div>
            ) : (
              <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase ${REQUEST_STATE_STYLE[r.status] ?? ""}`}>
                {r.status}
              </span>
            )}
            {r.status === "denied" && r.denial_reason && (
              <p className="mt-1.5 rounded-md bg-asphalt/5 p-2 text-[0.719rem] italic text-ink">"{r.denial_reason}"</p>
            )}
            {r.status === "approved" && (
              <div className="mt-2 rounded-md bg-asphalt/5 p-2">
                <div className="mb-0.5 flex items-center justify-between">
                  <p className="font-mono text-[0.563rem] uppercase tracking-wide text-muted">Contact {contacts[r.id]?.display_name ?? "them"}</p>
                  <Link to={`/requests/${r.id}/chat`} className="text-[0.688rem] font-semibold text-racing">
                    Message
                  </Link>
                </div>
                {contacts[r.id] && (
                  <>
                    {contacts[r.id].email && (
                      <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].email}</p>
                    )}
                    {contacts[r.id].phone && (
                      <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].phone}</p>
                    )}
                    {/* Each channel is the other person's choice now (0033).
                        Say so, rather than showing an empty block. */}
                    {!contacts[r.id].email && !contacts[r.id].phone && (
                      <p className="text-[0.719rem] text-muted">
                        They'd rather coordinate through messages — use Message above.
                      </p>
                    )}
                  </>
                )}
                {r.due_at && (
                  <p className="mt-1 font-mono text-[0.625rem] text-muted">Due back {formatDueDate(r.due_at)}</p>
                )}
                <button
                  type="button"
                  onClick={() => markReturned(r.id)}
                  disabled={completingId === r.id}
                  className="mt-1.5 text-[0.688rem] font-semibold text-racing underline disabled:opacity-50"
                >
                  {completingId === r.id ? "Marking returned…" : "Mark tool returned"}
                </button>
              </div>
            )}
            <ReportUserButton
              reportedId={r.borrower_id}
              reportedName={r.borrower?.display_name}
              requestId={r.id}
              className="mt-1.5 block"
            />
          </div>
        ))}
      </div>

      <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Outgoing</p>
      {outgoing.length === 0 && <p className="text-sm text-muted">You haven't requested anything yet.</p>}
      <div className="space-y-2">
        {outgoing.map((r) => (
          <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.781rem] leading-snug text-asphalt">
                Your request for <b>{r.tool?.name}</b> from {r.lender?.display_name ?? "the owner"}
              </p>
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase ${REQUEST_STATE_STYLE[r.status] ?? ""}`}>
                {r.status}
              </span>
            </div>
            {r.status === "denied" && r.denial_reason && (
              <p className="mt-1.5 rounded-md bg-asphalt/5 p-2 text-[0.719rem] italic text-ink">"{r.denial_reason}"</p>
            )}
            {/* Withdrawing a request had no path at all — borrow_requests has
                no UPDATE policy, so the 'cancelled' enum value was unreachable
                (audit RLS-2). Only while still pending: ending an approved
                loan is "Mark tool returned". */}
            {r.status === "pending" && (
              <button
                type="button"
                onClick={() => cancelRequest(r.id)}
                disabled={cancellingId === r.id}
                className="mt-1.5 text-[0.688rem] font-semibold text-muted underline disabled:opacity-50"
              >
                {cancellingId === r.id ? "Withdrawing…" : "Withdraw request"}
              </button>
            )}
            {r.status === "approved" && (
              <div className="mt-2 rounded-md bg-asphalt/5 p-2">
                <div className="mb-0.5 flex items-center justify-between">
                  <p className="font-mono text-[0.563rem] uppercase tracking-wide text-muted">Contact {contacts[r.id]?.display_name ?? "them"}</p>
                  <Link to={`/requests/${r.id}/chat`} className="text-[0.688rem] font-semibold text-racing">
                    Message
                  </Link>
                </div>
                {contacts[r.id] && (
                  <>
                    {contacts[r.id].email && (
                      <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].email}</p>
                    )}
                    {contacts[r.id].phone && (
                      <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].phone}</p>
                    )}
                    {/* Each channel is the other person's choice now (0033).
                        Say so, rather than showing an empty block. */}
                    {!contacts[r.id].email && !contacts[r.id].phone && (
                      <p className="text-[0.719rem] text-muted">
                        They'd rather coordinate through messages — use Message above.
                      </p>
                    )}
                  </>
                )}
                {r.due_at && (
                  <p className="mt-1 font-mono text-[0.625rem] text-muted">Due back {formatDueDate(r.due_at)}</p>
                )}
                <button
                  type="button"
                  onClick={() => markReturned(r.id)}
                  disabled={completingId === r.id}
                  className="mt-1.5 text-[0.688rem] font-semibold text-racing underline disabled:opacity-50"
                >
                  {completingId === r.id ? "Marking returned…" : "Mark tool returned"}
                </button>
              </div>
            )}
            <ReportUserButton
              reportedId={r.lender_id}
              reportedName={r.lender?.display_name}
              requestId={r.id}
              className="mt-1.5 block"
            />
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * What you lend and what you have borrowed, on one screen.
 *
 * These used to be two tabs. Requests behind a tab is the wrong shape for
 * this app: a borrow request is the thing that needs answering, and putting
 * it behind a control you have to know to press means the state that matters
 * most is the state you cannot see. Sequential sections with a rule between
 * them show both at once and cost one scroll.
 */
export default function MyTools() {
  const { user } = useAuth();

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3 pt-4">
        <BrandBar />
      </div>

      <div className="px-4 py-3.5">
        {/* Above the fold rather than buried with the requests: the point is
            that push exists, and someone who never scrolls past their own
            listings is exactly who has not heard of it. */}
        <PushNudge />

        {/* Landmarks, not just headings. One screen now carries two lists that
            can name the same tool -- your saw as a listing, and someone's
            request for it -- so the halves have to be distinguishable to
            anyone navigating by region rather than by eye. */}
        <section aria-label="My listings">
          <SectionHeading>My listings</SectionHeading>
          <Listings user={user} />
        </section>

        {/* A real rule, not just spacing. The two halves are different kinds
            of thing -- what you own versus what is in motion -- and whitespace
            alone reads as one long list. */}
        <hr className="my-6 border-0 border-t-2 border-cardBorder" />

        <section aria-label="Borrows and requests">
          <SectionHeading>Borrows &amp; requests</SectionHeading>
          <Requests user={user} />
        </section>
      </div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 className="mb-2.5 font-condensed text-base font-bold uppercase tracking-wide text-asphalt">
      {children}
    </h2>
  );
}

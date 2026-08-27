import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { REQUEST_STATE_STYLE } from "../lib/toolStatus";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";
import ToolCard from "../components/ToolCard";
import ReportUserButton from "../components/ReportUserButton";

const PAGE_SIZE = 100;

function Listings({ user }) {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("tools")
        .select("id, name, status, monetize, price, price_duration_unit, for_sale, photos")
        .eq("crib_id", user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!mounted) return;
      if (error) setError(error.message);
      else setTools(data ?? []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user.id]);

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
      {!loading && error && <p className="py-8 text-center text-sm text-signal">{error}</p>}
      {!loading && !error && tools.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">Nothing listed yet — add your first tool above.</p>
      )}

      <div className="space-y-2.5">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} showOwner={false} />
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
  const [denyReason, setDenyReason] = useState("");
  const [completingId, setCompletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: inData, error: inErr }, { data: outData, error: outErr }] = await Promise.all([
      supabase
        .from("borrow_requests")
        .select("id, status, borrower_id, wants_instruction, requested_at, denial_reason, tool:tools(name), borrower:profiles!borrow_requests_borrower_id_fkey(display_name)")
        .eq("lender_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("borrow_requests")
        .select("id, status, lender_id, requested_at, denial_reason, tool:tools(name), lender:profiles!borrow_requests_lender_id_fkey(display_name)")
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

  async function decide(requestId, approve, reason) {
    setActingOn(requestId);
    setError("");
    const { error } = approve
      ? await supabase.rpc("approve_borrow_request", { p_request_id: requestId })
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
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={actingOn === r.id}
                  onClick={() => decide(r.id, true)}
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
                  <p className="font-mono text-[0.563rem] uppercase tracking-wide text-muted">Contact {contacts[r.id]?.display_name?.split(" ")[0] ?? "them"}</p>
                  <Link to={`/requests/${r.id}/chat`} className="text-[0.688rem] font-semibold text-racing">
                    Message
                  </Link>
                </div>
                {contacts[r.id] && (
                  <>
                    <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].email}</p>
                    {contacts[r.id].phone && <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].phone}</p>}
                  </>
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
            {r.status === "approved" && (
              <div className="mt-2 rounded-md bg-asphalt/5 p-2">
                <div className="mb-0.5 flex items-center justify-between">
                  <p className="font-mono text-[0.563rem] uppercase tracking-wide text-muted">Contact {contacts[r.id]?.display_name?.split(" ")[0] ?? "them"}</p>
                  <Link to={`/requests/${r.id}/chat`} className="text-[0.688rem] font-semibold text-racing">
                    Message
                  </Link>
                </div>
                {contacts[r.id] && (
                  <>
                    <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].email}</p>
                    {contacts[r.id].phone && <p className="text-[0.719rem] font-semibold text-asphalt">{contacts[r.id].phone}</p>}
                  </>
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

export default function MyTools() {
  const { user } = useAuth();
  const [tab, setTab] = useState("listings");

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3 pt-4">
        <BrandBar />
        <div className="flex gap-0 rounded-lg bg-panel p-0.5">
          {[["listings", "My Listings"], ["requests", "Requests"]].map(([val, label]) => (
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

      <div className="px-4 py-3.5">
        {tab === "listings" ? <Listings user={user} /> : <Requests user={user} />}
      </div>
    </div>
  );
}

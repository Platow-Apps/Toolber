import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";

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

const REQUEST_STATE_STYLE = {
  pending: "bg-[#FCF1D6] text-[#8A6300]",
  approved: "bg-[#E9F3E9] text-[#2E6B2E]",
  denied: "bg-[#FCEBEB] text-signal",
  completed: "bg-[#EEECE8] text-steel",
  cancelled: "bg-[#EEECE8] text-steel",
};

function Listings({ user }) {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("tools")
      .select("id, name, status, monetize, price, price_duration_unit")
      .eq("crib_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (!error) setTools(data ?? []);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.id]);

  return (
    <>
      <Link
        to="/my-tools/new"
        className="mb-3.5 flex w-full items-center justify-center gap-2 rounded-lg bg-asphalt py-3 font-condensed text-[13px] font-bold uppercase tracking-wide text-safety"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        List a tool
      </Link>

      {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
      {!loading && tools.length === 0 && (
        <p className="py-12 text-center text-sm text-muted">Nothing listed yet — add your first tool above.</p>
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
              <span className={`mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${STATUS_STYLE[tool.status] ?? ""}`}>
                {STATUS_LABEL[tool.status] ?? tool.status}
              </span>
            </div>
            <span className={`flex-shrink-0 font-mono text-[12px] font-bold ${tool.monetize ? "text-[#8B6F1F]" : "text-[#3B7A3F]"}`}>
              {tool.monetize ? `$${tool.price}/${tool.price_duration_unit?.replace("_", " ") ?? "day"}` : "Free"}
            </span>
          </Link>
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

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: inData }, { data: outData }] = await Promise.all([
      supabase
        .from("borrow_requests")
        .select("id, status, wants_instruction, requested_at, tool:tools(name), borrower:profiles!borrow_requests_borrower_id_fkey(display_name)")
        .eq("lender_id", user.id)
        .order("requested_at", { ascending: false }),
      supabase
        .from("borrow_requests")
        .select("id, status, requested_at, tool:tools(name), lender:profiles!borrow_requests_lender_id_fkey(display_name)")
        .eq("borrower_id", user.id)
        .order("requested_at", { ascending: false }),
    ]);
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

  async function decide(requestId, approve) {
    setActingOn(requestId);
    const rpc = approve ? "approve_borrow_request" : "deny_borrow_request";
    const { error } = await supabase.rpc(rpc, { p_request_id: requestId });
    setActingOn(null);
    if (!error) await load();
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;

  return (
    <>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted">Incoming</p>
      {incoming.length === 0 && <p className="mb-4 text-sm text-muted">No requests on your tools yet.</p>}
      <div className="mb-5 space-y-2">
        {incoming.map((r) => (
          <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
            <p className="mb-1 text-[12.5px] leading-snug text-asphalt">
              <b>{r.borrower?.display_name ?? "Someone"}</b> wants to borrow your <b>{r.tool?.name}</b>
            </p>
            {r.wants_instruction && <p className="mb-1.5 text-[11px] text-muted">Asked for a quick walkthrough</p>}
            {r.status === "pending" ? (
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={actingOn === r.id}
                  onClick={() => decide(r.id, true)}
                  className="rounded-md bg-asphalt px-3 py-1.5 text-[11px] font-bold text-safety disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actingOn === r.id}
                  onClick={() => decide(r.id, false)}
                  className="rounded-md border border-steelLight px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            ) : (
              <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase ${REQUEST_STATE_STYLE[r.status] ?? ""}`}>
                {r.status}
              </span>
            )}
            {r.status === "approved" && contacts[r.id] && (
              <div className="mt-2 rounded-md bg-asphalt/5 p-2">
                <p className="font-mono text-[9px] uppercase tracking-wide text-muted">Contact {contacts[r.id].display_name?.split(" ")[0] ?? "them"}</p>
                <p className="text-[11.5px] font-semibold text-asphalt">{contacts[r.id].email}</p>
                {contacts[r.id].phone && <p className="text-[11.5px] font-semibold text-asphalt">{contacts[r.id].phone}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted">Outgoing</p>
      {outgoing.length === 0 && <p className="text-sm text-muted">You haven't requested anything yet.</p>}
      <div className="space-y-2">
        {outgoing.map((r) => (
          <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] leading-snug text-asphalt">
                Your request for <b>{r.tool?.name}</b> from {r.lender?.display_name ?? "the owner"}
              </p>
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase ${REQUEST_STATE_STYLE[r.status] ?? ""}`}>
                {r.status}
              </span>
            </div>
            {r.status === "approved" && contacts[r.id] && (
              <div className="mt-2 rounded-md bg-asphalt/5 p-2">
                <p className="font-mono text-[9px] uppercase tracking-wide text-muted">Contact {contacts[r.id].display_name?.split(" ")[0] ?? "them"}</p>
                <p className="text-[11.5px] font-semibold text-asphalt">{contacts[r.id].email}</p>
                {contacts[r.id].phone && <p className="text-[11.5px] font-semibold text-asphalt">{contacts[r.id].phone}</p>}
              </div>
            )}
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
              onClick={() => setTab(val)}
              className={`flex-1 rounded-md py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
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

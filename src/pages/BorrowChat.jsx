import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const SELECT_COLUMNS =
  "id, status, borrower_id, lender_id, tool:tools(name), borrower:profiles!borrow_requests_borrower_id_fkey(display_name), lender:profiles!borrow_requests_lender_id_fkey(display_name)";

// In-app chat for a specific approved (or completed) borrow request —
// supplements, doesn't replace, the email/phone reveal on ToolDetail/MyTools
// (get_borrow_contact). RLS on borrow_messages already scopes reads/writes to
// the two parties of an approved/completed request, so this screen mostly
// just needs to render that faithfully rather than re-check anything itself.
export default function BorrowChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [request, setRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: reqData, error: reqErr }, { data: msgData, error: msgErr }] = await Promise.all([
      supabase.from("borrow_requests").select(SELECT_COLUMNS).eq("id", id).single(),
      supabase.from("borrow_messages").select("id, sender_id, body, created_at").eq("request_id", id).order("created_at", { ascending: true }),
    ]);

    if (reqErr) {
      setError(reqErr.message);
      setLoading(false);
      return;
    }
    setRequest(reqData);
    // A denied/pending request's messages are invisible under RLS regardless
    // (see 0013_borrow_chat.sql), so an empty/errored read here just means
    // "no messages to show", not something to surface as a page-level error.
    setMessages(msgErr ? [] : (msgData ?? []));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`borrow_messages:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "borrow_messages", filter: `request_id=eq.${id}` },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (messages.length > 0) {
      listEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length]);

  async function sendMessage(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setError("");
    const { data, error } = await supabase
      .from("borrow_messages")
      .insert({ request_id: id, sender_id: user.id, body })
      .select("id, sender_id, body, created_at")
      .single();
    setSending(false);

    if (error) {
      setError(error.message);
      return;
    }
    // Optimistic append — the realtime echo of our own insert is de-duped by
    // id in the subscription handler above, so this doesn't double up.
    setMessages((prev) => [...prev, data]);
    setDraft("");
  }

  const isBorrower = request?.borrower_id === user.id;
  const isLender = request?.lender_id === user.id;
  const counterpartName = (isBorrower ? request?.lender : request?.borrower)?.display_name ?? "them";
  const canChat = (isBorrower || isLender) && (request?.status === "approved" || request?.status === "completed");

  return (
    <div className="flex h-app flex-col">
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
        <div className="min-w-0 flex-1">
          <p className="truncate font-condensed text-base font-bold uppercase tracking-wide text-safety">
            {loading ? "Chat" : counterpartName}
          </p>
          {!loading && request?.tool?.name && <p className="truncate text-[0.688rem] text-steelLight">{request.tool.name}</p>}
        </div>
      </div>

      {loading && <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>}
      {!loading && error && <p className="px-4 py-6 text-center text-sm text-signal">{error}</p>}

      {!loading && !error && !canChat && (
        <p className="px-4 py-6 text-center text-sm text-muted">
          This chat is only available to the borrower and lender of an approved request.
        </p>
      )}

      {!loading && !error && canChat && (
        <>
          <form onSubmit={sendMessage} className="flex gap-1.5 border-b border-cardBorder bg-page px-4 py-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message…"
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="flex-shrink-0 rounded-lg bg-asphalt px-4 py-2.5 text-sm font-bold uppercase text-safety disabled:opacity-50"
            >
              Send
            </button>
          </form>

          <div className="flex-1 overflow-y-auto px-4 py-3.5">
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                No messages yet — say hi and arrange a time to meet up.
              </p>
            )}
            <div className="space-y-2">
              {messages.map((m) => {
                const mine = m.sender_id === user.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        mine ? "bg-asphalt text-safety" : "border border-cardBorder bg-white text-asphalt"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-0.5 text-[0.563rem] ${mine ? "text-steelLight" : "text-muted"}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={listEndRef} />
          </div>
        </>
      )}
    </div>
  );
}

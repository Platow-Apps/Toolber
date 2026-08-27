import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import ReportUserButton from "../components/ReportUserButton";

const SELECT_COLUMNS =
  "id, participant_a_id, participant_b_id, participant_a:profiles!conversations_participant_a_id_fkey(display_name), participant_b:profiles!conversations_participant_b_id_fkey(display_name)";

// General 1:1 chat between any two registered users (0019_general_messaging.sql)
// — not tied to a borrow request. RLS already scopes conversations/
// conversation_messages to the two participants, so a non-participant
// landing here just gets a normal "not found"-shaped error from the RLS-
// filtered .single() read, same as any other protected screen.
export default function Conversation() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: convoData, error: convoErr }, { data: msgData, error: msgErr }] = await Promise.all([
      supabase.from("conversations").select(SELECT_COLUMNS).eq("id", conversationId).single(),
      supabase
        .from("conversation_messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
    ]);

    if (convoErr) {
      setError(convoErr.message);
      setLoading(false);
      return;
    }
    setConversation(convoData);
    setMessages(msgErr ? [] : (msgData ?? []));
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`conversation_messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

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
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, sender_id: user.id, body })
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

  const isA = conversation?.participant_a_id === user.id;
  const counterpartId = isA ? conversation?.participant_b_id : conversation?.participant_a_id;
  const counterpartName = (isA ? conversation?.participant_b : conversation?.participant_a)?.display_name ?? "them";

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
        <p className="min-w-0 flex-1 truncate font-condensed text-base font-bold uppercase tracking-wide text-safety">
          {loading ? "Chat" : counterpartName}
        </p>
      </div>

      {!loading && !error && conversation && (
        <div className="px-4 pt-2">
          <ReportUserButton reportedId={counterpartId} reportedName={counterpartName} />
        </div>
      )}

      {loading && <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>}
      {!loading && error && <p className="px-4 py-6 text-center text-sm text-signal">{error}</p>}

      {!loading && !error && conversation && (
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
                No messages yet — say hi.
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

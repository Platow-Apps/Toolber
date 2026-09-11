import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { shouldOfferPush } from "../lib/push";
import { supabase } from "../lib/supabaseClient";
import PushPrompt from "./PushPrompt";

/**
 * "Does anyone have a…" — asking a group for a tool nobody has listed.
 *
 * Search can only answer "who has already listed this?", and the honest
 * answer is usually nobody: a chest holds what someone thought to write down,
 * not what they own. The tool is often in a neighbour's garage, unlisted,
 * because listing it never occurred to them until somebody asked.
 *
 * Every write goes through an RPC (0062). The tables carry no INSERT grant at
 * all, deliberately: posting an ask sends a notification to every approved
 * member, and an ask nobody hears about is worse than no ask — so the path
 * that notifies is the only path there is.
 */
export default function GroupToolRequests({ groupId, userId, isGroupAdmin }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const [asking, setAsking] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [posting, setPosting] = useState(false);

  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState([]);
  const [reply, setReply] = useState("");
  const [offerToolId, setOfferToolId] = useState("");
  const [myTools, setMyTools] = useState([]);
  const [replying, setReplying] = useState(false);
  const [offerPush, setOfferPush] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("group_tool_requests_for", {
      p_group_id: groupId,
      p_include_closed: showClosed,
    });
    setLoading(false);
    if (err) return setError(err.message);
    setError("");
    setRequests(data ?? []);
  }, [groupId, showClosed]);

  useEffect(() => {
    load();
  }, [load]);

  // Loaded when a thread is opened, not on mount. It exists only so a reply
  // can say "I have one, here it is", and most visits to a group page never
  // open one — fetching every member's own listings to populate a dropdown
  // nobody looks at is a query for nothing.
  const loadMyTools = useCallback(async () => {
    if (!userId || myTools.length > 0) return;
    const { data } = await supabase
      .from("tools")
      .select("id, name")
      .eq("chest_id", userId)
      .eq("paused", false)
      .order("name");
    setMyTools(data ?? []);
  }, [userId, myTools.length]);

  async function openThread(id) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    loadMyTools();
    setReply("");
    setOfferToolId("");
    const { data, error: err } = await supabase.rpc("group_tool_request_thread", { p_request_id: id });
    if (err) return setError(err.message);
    setThread(data ?? []);
  }

  async function post() {
    if (!title.trim()) return setError("Say what you are looking for.");
    setPosting(true);
    const { error: err } = await supabase.rpc("create_group_tool_request", {
      p_group_id: groupId,
      p_title: title.trim(),
      p_details: details.trim() || null,
      p_needed_by: neededBy || null,
    });
    setPosting(false);
    if (err) return setError(err.message);
    setTitle("");
    setDetails("");
    setNeededBy("");
    setAsking(false);
    setError("");
    load();
    // The same moment ToolDetail uses (shouldOfferPush gates the asking):
    // you have just put a question to other people and a reply is coming,
    // which is the one point where "tell me when they answer" is obviously
    // worth a tap rather than an interruption.
    if (await shouldOfferPush()) setOfferPush(true);
  }

  async function sendReply(requestId) {
    if (!reply.trim()) return setError("Write a reply first.");
    setReplying(true);
    const { error: err } = await supabase.rpc("reply_to_group_tool_request", {
      p_request_id: requestId,
      p_body: reply.trim(),
      p_tool_id: offerToolId || null,
    });
    setReplying(false);
    if (err) return setError(err.message);
    setReply("");
    setOfferToolId("");
    setError("");
    const { data } = await supabase.rpc("group_tool_request_thread", { p_request_id: requestId });
    setThread(data ?? []);
    load();
  }

  async function close(requestId, status) {
    const { error: err } = await supabase.rpc("close_group_tool_request", {
      p_request_id: requestId,
      p_status: status,
    });
    if (err) return setError(err.message);
    setError("");
    load();
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.688rem] uppercase tracking-wide text-muted">Wanted in this group</p>
        <button
          type="button"
          onClick={() => setAsking((v) => !v)}
          className="rounded-lg border border-asphalt px-2.5 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt"
        >
          {asking ? "Cancel" : "Ask for a tool"}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-[#F0C4C4] bg-[#FCEBEB] p-2.5 text-[0.75rem] text-signal">
          {error}
        </p>
      )}

      {asking && (
        <div className="mb-3 rounded-lg border border-cardBorder bg-white p-3">
          <label
            htmlFor="wanted-title"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            What are you looking for?
          </label>
          <input
            id="wanted-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Wet tile saw"
            className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />

          <label
            htmlFor="wanted-details"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            Anything else worth knowing (optional)
          </label>
          <textarea
            id="wanted-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Retiling a small bathroom, would need it for a weekend."
            className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />

          <label
            htmlFor="wanted-by"
            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
          >
            Needed by (optional)
          </label>
          <input
            id="wanted-by"
            type="date"
            value={neededBy}
            onChange={(e) => setNeededBy(e.target.value)}
            className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.813rem] text-asphalt"
          />

          <button
            type="button"
            disabled={posting}
            onClick={post}
            className="rounded-lg bg-safety px-3 py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt disabled:opacity-40"
          >
            {posting ? "Posting…" : "Ask the group"}
          </button>
          <p className="mt-1.5 text-[0.688rem] leading-relaxed text-muted">
            Everyone in this group is told. Nobody outside it sees this.
          </p>
        </div>
      )}

      {offerPush && <PushPrompt onClose={() => setOfferPush(false)} />}

      {loading && <p className="py-4 text-center text-sm text-muted">Loading…</p>}

      {!loading && requests.length === 0 && (
        <p className="rounded-lg border border-cardBorder bg-white p-3 text-[0.75rem] leading-relaxed text-muted">
          Nothing wanted right now. If you need something nobody has listed, ask — plenty of tools are sitting
          in a garage because listing them never came up.
        </p>
      )}

      <div className="space-y-2">
        {requests.map((r) => {
          const mine = r.requester_id === userId;
          return (
            <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-semibold text-asphalt">{r.title}</p>
                  <p className="font-mono text-[0.688rem] text-muted">
                    {r.requester_name ?? "A neighbor"}
                    {r.needed_by && ` · by ${new Date(r.needed_by).toLocaleDateString()}`}
                    {r.status !== "open" && ` · ${r.status}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openThread(r.id)}
                  className="flex-shrink-0 text-[0.75rem] font-semibold text-racing"
                >
                  {openId === r.id
                    ? "Hide"
                    : `${r.reply_count} ${Number(r.reply_count) === 1 ? "reply" : "replies"}`}
                </button>
              </div>

              {r.details && <p className="mt-1 text-[0.75rem] leading-relaxed text-ink">{r.details}</p>}

              {openId === r.id && (
                <div className="mt-2.5 border-t border-cardBorder pt-2.5">
                  {thread.length === 0 && <p className="mb-2 text-[0.75rem] text-muted">No replies yet.</p>}
                  <div className="mb-2 space-y-1.5">
                    {thread.map((m) => (
                      <div key={m.id} className="rounded-md bg-[#F6F5F2] px-2.5 py-1.5">
                        <p className="font-mono text-[0.688rem] text-muted">
                          {m.responder_name ?? "A neighbor"}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-[0.75rem] text-asphalt">
                          {m.body}
                        </p>
                        {m.tool_id && (
                          <Link
                            to={`/tool/${m.tool_id}`}
                            className="text-[0.75rem] font-semibold text-racing"
                          >
                            {m.tool_name ?? "See the tool"} →
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>

                  {r.status === "open" && (
                    <>
                      <label htmlFor={`reply-${r.id}`} className="sr-only">
                        Reply to {r.title}
                      </label>
                      <textarea
                        id={`reply-${r.id}`}
                        rows={2}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="I've got one you can borrow."
                        className="mb-1.5 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.75rem] text-asphalt"
                      />
                      {myTools.length > 0 && (
                        <>
                          <label
                            htmlFor={`offer-${r.id}`}
                            className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-muted"
                          >
                            Offer one of your listings (optional)
                          </label>
                          <select
                            id={`offer-${r.id}`}
                            value={offerToolId}
                            onChange={(e) => setOfferToolId(e.target.value)}
                            className="mb-1.5 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.75rem] text-asphalt"
                          >
                            <option value="">No specific listing</option>
                            {myTools.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={replying}
                          onClick={() => sendReply(r.id)}
                          className="rounded-lg bg-asphalt px-3 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-safety disabled:opacity-40"
                        >
                          {replying ? "Sending…" : "Reply"}
                        </button>
                        {(mine || isGroupAdmin) && (
                          <>
                            <button
                              type="button"
                              onClick={() => close(r.id, "fulfilled")}
                              className="rounded-lg border border-steelLight px-3 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt"
                            >
                              Got one
                            </button>
                            <button
                              type="button"
                              onClick={() => close(r.id, "withdrawn")}
                              className="rounded-lg border border-steelLight px-3 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-muted"
                            >
                              Withdraw
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {r.status !== "open" && (mine || isGroupAdmin) && (
                    <button
                      type="button"
                      onClick={() => close(r.id, "open")}
                      className="rounded-lg border border-steelLight px-3 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        <span className="text-[0.75rem] text-muted">Include closed requests</span>
      </label>
    </div>
  );
}

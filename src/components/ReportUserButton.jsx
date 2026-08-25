import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { useAuth } from "../contexts/AuthContext";

/**
 * A trust & safety escape hatch, reachable from anywhere a user is dealing
 * with a specific named counterpart (a chat thread, a borrow request, a tool
 * listing) — reports go straight to `user_reports`, readable only by
 * platform admins (see 0015_user_reports.sql), same pattern as `feedback`.
 * No admin UI page exists for this yet, matching how `feedback`/`events`
 * are read today — via the Supabase dashboard, not a page in the app.
 *
 * @param {object} props
 * @param {string} props.reportedId    the profile being reported
 * @param {string} [props.reportedName] shown in the button/prompt copy
 * @param {string} [props.requestId]   optional borrow_requests context
 * @param {string} [props.toolId]      optional tools context
 * @param {string} [props.className]
 */
export default function ReportUserButton({ reportedId, reportedName, requestId = null, toolId = null, className = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Can't report yourself, and this only makes sense once someone is signed in.
  if (!user || !reportedId || user.id === reportedId) return null;

  async function submit(e) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError("");
    const { error } = await supabase.from("user_reports").insert({
      reporter_id: user.id,
      reported_id: reportedId,
      reason: trimmed,
      context_request_id: requestId,
      context_tool_id: toolId,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(user.id, EVENTS.USER_REPORTED, { reported_id: reportedId, request_id: requestId, tool_id: toolId });
    setSent(true);
  }

  if (sent) {
    return <p className={`text-[0.688rem] text-muted ${className}`}>Report sent — thanks for flagging this.</p>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`text-[0.688rem] font-semibold text-muted underline ${className}`}>
        Report {reportedName ?? "this user"}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className={className}>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder={`What happened with ${reportedName ?? "this user"}? This goes to Toolber admins only.`}
        className="mb-1.5 w-full resize-none rounded-md border border-cardBorder bg-white px-2 py-1.5 text-[0.719rem] text-asphalt outline-none"
      />
      {error && <p className="mb-1.5 text-[0.688rem] text-signal">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={submitting || !reason.trim()}
          className="rounded-md bg-asphalt px-2.5 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send Report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-steelLight px-2.5 py-1.5 text-[0.688rem] font-bold text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

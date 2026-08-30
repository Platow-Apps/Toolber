import { supabase } from "./supabaseClient";

// Every meaningful user action writes an `events` row — that is the whole
// analytics strategy, no third-party vendor (see CLAUDE.md). Event type names
// live here rather than as loose strings at call sites so the vocabulary stays
// consistent and greppable; check docs/technical-design.md -> Analytics &
// feedback before inventing a new one.
export const EVENTS = {
  ACCOUNT_CREATED: "account_created",
  ONBOARDING_COMPLETED: "onboarding_completed",
  SEARCH_PERFORMED: "search_performed",
  TOOL_VIEWED: "tool_viewed",
  TOOL_LISTED: "tool_listed",
  TOOL_UPDATED: "tool_updated",
  TOOL_DELETED: "tool_deleted",
  TOOL_PAUSED: "tool_paused",
  TOOL_RESUMED: "tool_resumed",
  BORROW_REQUESTED: "borrow_requested",
  BORROW_APPROVED: "borrow_approved",
  BORROW_DENIED: "borrow_denied",
  BORROW_COMPLETED: "borrow_completed",
  BORROW_CANCELLED: "borrow_cancelled",
  FAVORITE_ADDED: "favorite_added",
  FAVORITE_REMOVED: "favorite_removed",
  GROUP_CREATED: "group_created",
  GROUP_JOINED: "group_joined",
  GROUP_MEMBERSHIP_DECIDED: "group_membership_decided",
  USER_REPORTED: "user_reported",
  ACCOUNT_DELETED: "account_deleted",
};

/**
 * Record an analytics event. Never throws and never blocks the caller's real
 * work: analytics failing must not turn a successful action into a visible
 * error. Failures are logged so they are at least noticeable in development.
 *
 * A null profileId is a no-op — the `events` insert policy requires
 * `profile_id = auth.uid()`, so anonymous events are rejected by the database
 * anyway (see docs/audit-2026-08-20.md, RLS-3).
 *
 * @param {string|null|undefined} profileId
 * @param {string} eventType  one of EVENTS
 * @param {object} [metadata]
 */
export async function logEvent(profileId, eventType, metadata) {
  if (!profileId) return;
  const { error } = await supabase
    .from("events")
    .insert({ profile_id: profileId, event_type: eventType, metadata: metadata ?? null });
  // eventType is passed as an argument rather than interpolated into the format
  // string, so it can never be read as a format specifier.
  if (error) console.warn("Failed to log event:", eventType, error);
}

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
  CHEST_VIEWED: "chest_viewed",
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
  PICKUP_REQUESTED: "pickup_requested",
  PICKUP_SHARED: "pickup_shared",
  FAVORITE_ADDED: "favorite_added",
  FAVORITE_REMOVED: "favorite_removed",
  GROUP_CREATED: "group_created",
  GROUP_JOINED: "group_joined",
  // Written server-side by the 0062 RPCs, not by logEvent -- listed so the
  // vocabulary stays in one place for the admin dashboard to read back.
  GROUP_TOOL_REQUEST_CREATED: "group_tool_request_created",
  GROUP_TOOL_REQUEST_REPLIED: "group_tool_request_replied",
  GROUP_MEMBERSHIP_DECIDED: "group_membership_decided",
  USER_REPORTED: "user_reported",
  ACCOUNT_DELETED: "account_deleted",
  // How often people move their area is the thing worth knowing here: it was
  // set once at onboarding and never editable, so nobody knows yet whether the
  // first answer is usually the right one.
  AREA_CHANGED: "area_changed",
};

// The only two events a signed-out visitor can reach, and the only two
// `log_visitor_event()` will accept (0065). Search and a tool's page are
// public; everything else in EVENTS happens behind RequireAuth, where the
// ordinary insert works and is attributed.
const VISITOR_EVENTS = new Set([EVENTS.SEARCH_PERFORMED, EVENTS.TOOL_VIEWED]);

/**
 * A random id for this browsing session, so three page views by one person do
 * not read as three people.
 *
 * sessionStorage rather than localStorage, deliberately: this exists to make
 * one visit coherent, not to recognise somebody on their next one. It is
 * generated client-side and therefore forgeable — nothing may treat it as a
 * security control (see 0065). Falls back to a module-level value when storage
 * throws, which it does in a private window and in some embedded webviews.
 */
let fallbackSessionId = null;
function visitorSessionId() {
  try {
    const existing = sessionStorage.getItem("toolber_visit");
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem("toolber_visit", fresh);
    return fresh;
  } catch {
    fallbackSessionId ??= crypto.randomUUID();
    return fallbackSessionId;
  }
}

/**
 * Record an analytics event. Never throws and never blocks the caller's real
 * work: analytics failing must not turn a successful action into a visible
 * error. Failures are logged so they are at least noticeable in development.
 *
 * Without a profileId this goes through `log_visitor_event()` instead of a
 * direct insert, which is what makes the signed-out half of the funnel
 * measurable at all — the `events` insert policy requires
 * `profile_id = auth.uid()` and always will (audit RLS-3, migration 0065).
 * Only the two public-page events take that path; anything else is dropped,
 * as it was before.
 *
 * @param {string|null|undefined} profileId
 * @param {string} eventType  one of EVENTS
 * @param {object} [metadata]
 */
export async function logEvent(profileId, eventType, metadata) {
  if (!profileId) return logVisitorEvent(eventType, metadata);
  const { error } = await supabase
    .from("events")
    .insert({ profile_id: profileId, event_type: eventType, metadata: metadata ?? null });
  // eventType is passed as an argument rather than interpolated into the format
  // string, so it can never be read as a format specifier.
  if (error) console.warn("Failed to log event:", eventType, error);
}

async function logVisitorEvent(eventType, metadata) {
  if (!VISITOR_EVENTS.has(eventType)) return;

  // A returning visitor's session is restored asynchronously, so a public page
  // renders once with no user before the JWT arrives and then again with one.
  // Without this check that first render logs an anonymous view and the second
  // logs an attributed one — the same visit counted twice, in two different
  // populations. getSession() reads the persisted session rather than the
  // network, so it answers before the auth state change fires.
  const { data } = await supabase.auth.getSession();
  if (data?.session) return;

  const { error } = await supabase.rpc("log_visitor_event", {
    p_event_type: eventType,
    p_session: visitorSessionId(),
    p_tool_id: metadata?.tool_id ?? null,
    p_query: metadata?.query ?? null,
    p_results: metadata?.results ?? null,
    p_near: metadata?.near ?? null,
  });
  if (error) console.warn("Failed to log visitor event:", eventType, error);
}

import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { canRequestAgain, formatDueDate, formatOnLoanUntil, formatPrice, statusLabel, statusStyle } from "../lib/toolStatus";
import { categoryLabel } from "../lib/toolCategories";
import { readSpecs } from "../lib/specs";
import { useAuth } from "../contexts/AuthContext";
import { useDismissableMenu } from "../lib/useDismissableMenu";
import ReportUserButton from "../components/ReportUserButton";
import PhotoGallery from "../components/PhotoGallery";
import PageHeader from "../components/PageHeader";
import PushPrompt from "../components/PushPrompt";
import { shouldOfferPush } from "../lib/push";

const CONDITION_LABEL = { new: "New", good: "Good", fair: "Fair" };

/**
 * Group names the owner shares with each of these borrowers.
 *
 * This is the only vetting signal the schema already carried, and it was
 * invisible at the one moment it matters -- deciding whether to hand a
 * stranger a tool. Sharing a group means somebody already approved them into
 * it, which is a good deal more than a display name.
 *
 * Needs no RPC: approved memberships are readable by any signed-in user
 * (0004's memberships_select_approved_public), precisely so that group
 * membership can be used as a trust signal.
 *
 * @returns {Promise<Record<string, string[]>>} borrower id -> group names
 */
async function loadSharedGroups(ownerId, borrowerIds) {
  const ids = [...new Set(borrowerIds.filter(Boolean))];
  if (!ownerId || ids.length === 0) return {};

  const { data, error } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id, groups(name)")
    .eq("status", "approved")
    .in("profile_id", [ownerId, ...ids]);

  if (error) {
    // Non-fatal: the decision controls still work, they just carry one less
    // signal. Better than failing the whole screen over a nicety.
    console.warn("Could not work out shared groups", error);
    return {};
  }

  const mine = new Set((data ?? []).filter((m) => m.profile_id === ownerId).map((m) => m.group_id));
  const shared = {};
  for (const m of data ?? []) {
    if (m.profile_id === ownerId || !mine.has(m.group_id)) continue;
    const name = m.groups?.name;
    if (!name) continue;
    if (!shared[m.profile_id]) shared[m.profile_id] = [];
    shared[m.profile_id].push(name);
  }
  return shared;
}

const SELECT_COLUMNS =
  "id, name, category, subcategory, condition, brand, kind, description, status, monetize, price, price_duration_unit, for_sale, due_at, default_loan_days, specs, paused, portable, supervised_required, chest_id, photos, profiles(display_name, approx_lat, approx_lng, map_pin_hidden, chest_public)";

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();

  const [tool, setTool] = useState(null);
  const [myRequest, setMyRequest] = useState(null); // most recent borrow_requests row by me, for this tool
  const [pickupLocation, setPickupLocation] = useState(null);
  const [ownerContact, setOwnerContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wantsInstruction, setWantsInstruction] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [borrowDays, setBorrowDays] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);
  const [favoriting, setFavoriting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]); // pending requests on this tool, owner-only
  const [pickupAsks, setPickupAsks] = useState([]); // approved borrowers waiting on a pickup spot, owner-only
  const [askingPickup, setAskingPickup] = useState(false);
  const [pickupFormId, setPickupFormId] = useState(null); // request id whose "where shall we meet" form is open
  const [pickupSpot, setPickupSpot] = useState("");
  const [savingPickup, setSavingPickup] = useState(false);
  const [decidingId, setDecidingId] = useState(null);
  const [denyingId, setDenyingId] = useState(null);
  const [denyReason, setDenyReason] = useState("");
  const [startingChat, setStartingChat] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [askingPrice, setAskingPrice] = useState(null); // owner's own reveal only, via get_asking_price()
  const [chestCount, setChestCount] = useState(0); // other listings by this owner
  const [sharedGroups, setSharedGroups] = useState({}); // borrower id -> group names in common
  const [messagingId, setMessagingId] = useState(null);
  const [offerPush, setOfferPush] = useState(false);
  const { open: ownerMenuOpen, setOpen: setOwnerMenuOpen, ref: ownerMenuRef } = useDismissableMenu();

  // Reachable while signed out (Search is public), so every per-user query is
  // conditional on there being a user at all.
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: toolData, error: toolErr }, { data: reqData }, { data: favData }] = await Promise.all([
      supabase.from("tools").select(SELECT_COLUMNS).eq("id", id).single(),
      userId
        ? supabase
            .from("borrow_requests")
            .select(
              "id, status, wants_instruction, requested_days, due_at, requested_at, denial_reason, pickup_requested_at, pickup_released_at"
            )
            .eq("tool_id", id)
            .eq("borrower_id", userId)
            .order("requested_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      userId
        ? supabase.from("favorites").select("id").eq("tool_id", id).eq("profile_id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (toolErr) {
      setError(toolErr.message);
      setLoading(false);
      return;
    }
    setTool(toolData);
    // Pre-fill the borrower's ask with the owner's usual period, without
    // clobbering a number they already typed (load() re-runs after actions).
    setBorrowDays((prev) => prev || (toolData.default_loan_days ? String(toolData.default_loan_days) : ""));
    setMyRequest(reqData ?? null);
    setFavoriteId(favData?.id ?? null);

    // Owner sees who's asking, right here — clicking your own "Requested"
    // tool used to just say "This is your tool" with no way to act on it.
    if (userId && toolData.chest_id === userId) {
      const borrowerJoin = "borrower:profiles!borrow_requests_borrower_id_fkey(display_name)";
      const [{ data: incoming }, { data: awaitingPickup }] = await Promise.all([
        supabase
          .from("borrow_requests")
          .select(`id, status, wants_instruction, requested_days, requested_at, borrower_id, message, ${borrowerJoin}`)
          .eq("tool_id", id)
          .eq("status", "pending")
          .order("requested_at", { ascending: true }),
        // Approved borrowers who have asked to collect and are waiting on an
        // answer. Two separate queries rather than one over both statuses:
        // they drive different controls and read as different work.
        supabase
          .from("borrow_requests")
          .select(`id, pickup_requested_at, ${borrowerJoin}`)
          .eq("tool_id", id)
          .eq("status", "approved")
          .not("pickup_requested_at", "is", null)
          .is("pickup_released_at", null)
          .order("pickup_requested_at", { ascending: true }),
      ]);
      setIncomingRequests(incoming ?? []);
      setPickupAsks(awaitingPickup ?? []);
      setSharedGroups(await loadSharedGroups(userId, (incoming ?? []).map((r) => r.borrower_id)));

      // asking_price isn't a public column (0021_tool_for_sale.sql) --
      // buyers see the for_sale flag and inquire via chat instead, but the
      // owner can see their own listed price back.
      if (toolData.for_sale) {
        const { data: price } = await supabase.rpc("get_asking_price", { p_tool_id: id });
        setAskingPrice(price ?? null);
      } else {
        setAskingPrice(null);
      }
    } else {
      setIncomingRequests([]);
      setPickupAsks([]);
      setSharedGroups({});
      setAskingPrice(null);
    }

    // Only the number of *other* listings, and only when the owner offers
    // them together. head:true means Postgres counts rather than returning
    // rows -- this is a link label, not a second tool list.
    if (toolData.profiles?.chest_public) {
      const { count } = await supabase
        .from("tools")
        .select("id", { count: "exact", head: true })
        .eq("chest_id", toolData.chest_id)
        .eq("paused", false)
        .neq("id", id);
      setChestCount(count ?? 0);
    } else {
      setChestCount(0);
    }

    if (reqData?.status === "approved") {
      const { data: contact } = await supabase.rpc("get_borrow_contact", { p_request_id: reqData.id });
      setOwnerContact(contact?.[0] ?? null);

      // Only once the lender has actually answered the pickup request
      // (0035_pickup_handshake.sql). Calling it earlier raises "the pickup
      // location has not been shared yet", which is correct server-side but
      // would surface here as a red error on a screen where nothing is wrong.
      if (reqData.pickup_released_at) {
        const { data: loc, error: locErr } = await supabase.rpc("get_pickup_location", { p_tool_id: id });
        if (locErr) setError(locErr.message);
        setPickupLocation(loc ?? null);
      } else {
        setPickupLocation(null);
      }
    } else {
      setPickupLocation(null);
      setOwnerContact(null);
    }

    setLoading(false);
  }, [id, userId]);

  useEffect(() => {
    load();
  }, [load]);

  // One view event per (tool, viewer). Anonymous views are dropped by logEvent
  // because the events insert policy requires profile_id = auth.uid().
  useEffect(() => {
    logEvent(userId, EVENTS.TOOL_VIEWED, { tool_id: id });
  }, [id, userId]);

  // Sends the visitor to sign in and back to this tool afterwards.
  function signInFirst() {
    navigate("/login", { state: { from: location } });
  }

  // This screen sits outside RequireAuth so logged-out visitors can browse, but
  // that also removes RequireAuth's onboarding redirect. Acting on a tool still
  // requires a completed profile — that is where ToS acceptance is recorded.
  const needsOnboarding = Boolean(userId) && profile != null && !profile.profile_complete;

  function finishOnboardingFirst() {
    navigate("/onboarding", { state: { from: location } });
  }

  // Any registered user can message a tool's owner before ever requesting to
  // borrow (0019_general_messaging.sql) — this is the dropdown's "Start
  // Chat" action.
  async function startChat() {
    if (!userId) return signInFirst();
    if (needsOnboarding) return finishOnboardingFirst();
    setOwnerMenuOpen(false);
    setStartingChat(true);
    setError("");
    const { data: conversationId, error } = await supabase.rpc("start_conversation", { p_other_user_id: tool.chest_id });
    setStartingChat(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(`/messages/${conversationId}`);
  }

  // Step 2 of the pickup handshake (0035): the borrower says they're ready to
  // collect. Nothing is disclosed by this — it just puts the ball in the
  // lender's court, which is the point of splitting it from approval.
  async function askForPickup() {
    if (!myRequest) return;
    setAskingPickup(true);
    setError("");
    const { error } = await supabase.rpc("request_pickup", { p_request_id: myRequest.id });
    setAskingPickup(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, EVENTS.PICKUP_REQUESTED, { tool_id: id, request_id: myRequest.id });
    await load();
  }

  // Step 3: the lender answers, either with the address already on the listing
  // or with a one-off spot for this borrower.
  async function releasePickup(requestId, useDefault) {
    setSavingPickup(true);
    setError("");
    const { error } = await supabase.rpc("set_pickup_for_request", {
      p_request_id: requestId,
      p_location: useDefault ? null : pickupSpot,
      p_use_default: useDefault,
    });
    setSavingPickup(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, EVENTS.PICKUP_SHARED, { tool_id: id, request_id: requestId, used_default: useDefault });
    setPickupFormId(null);
    setPickupSpot("");
    await load();
  }

  // Any registered user can message any other (0019); the owner just had no
  // route to it from the request they were deciding on.
  async function messageBorrower(borrowerId) {
    setMessagingId(borrowerId);
    setError("");
    const { data: conversationId, error } = await supabase.rpc("start_conversation", {
      p_other_user_id: borrowerId,
    });
    setMessagingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(`/messages/${conversationId}`);
  }

  async function handleRequest() {
    if (!userId) return signInFirst();
    if (needsOnboarding) return finishOnboardingFirst();
    setRequesting(true);
    setError("");
    const { error } = await supabase.rpc("request_borrow", {
      p_tool_id: id,
      p_wants_instruction: wantsInstruction,
      p_days: borrowDays ? Number(borrowDays) : null,
      p_message: requestMessage.trim() || null,
    });
    setRequesting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, EVENTS.BORROW_REQUESTED, { tool_id: id });
    await load();

    // The moment the question answers itself: they have just asked for
    // something and a reply is coming. shouldOfferPush() declines to ask if
    // permission was already decided either way, or if they have said "not
    // now" before -- see the note in PushPrompt for why one shot is all there
    // is.
    if (await shouldOfferPush()) setOfferPush(true);
  }

  async function markReturned() {
    if (!myRequest) return;
    setCompleting(true);
    setError("");
    const { error } = await supabase.rpc("complete_borrow_request", { p_request_id: myRequest.id });
    setCompleting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, EVENTS.BORROW_COMPLETED, { request_id: myRequest.id, tool_id: id });
    await load();
  }

  async function decideIncoming(requestId, approve, reason) {
    setDecidingId(requestId);
    setError("");
    const { error } = approve
      ? await supabase.rpc("approve_borrow_request", { p_request_id: requestId })
      : await supabase.rpc("deny_borrow_request", { p_request_id: requestId, p_reason: reason || null });
    setDecidingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, approve ? EVENTS.BORROW_APPROVED : EVENTS.BORROW_DENIED, { request_id: requestId });
    setDenyingId(null);
    setDenyReason("");
    await load();
  }

  async function toggleFavorite() {
    if (!userId) return signInFirst();
    if (needsOnboarding) return finishOnboardingFirst();
    setFavoriting(true);
    setError("");
    if (favoriteId) {
      const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
      if (error) setError(error.message);
      else setFavoriteId(null);
    } else {
      const { data, error } = await supabase
        .from("favorites")
        .insert({ profile_id: userId, tool_id: id })
        .select("id")
        .single();
      if (error) {
        setError(error.message);
      } else {
        setFavoriteId(data?.id ?? null);
        await logEvent(userId, EVENTS.FAVORITE_ADDED, { tool_id: id });
      }
    }
    setFavoriting(false);
  }

  const isOwner = Boolean(userId) && tool?.chest_id === userId;
  // A paused listing is withdrawn by its owner but still resolves by direct
  // link, and request_borrow() refuses it server-side — so the button must
  // not be offered either (0023_tool_management.sql).
  const isAvailable = tool?.status === "available" && !tool?.paused;
  const onLoanUntil = formatOnLoanUntil(tool);

  return (
    <div className="pb-6">
      {offerPush && <PushPrompt onClose={() => setOfferPush(false)} />}
      <PageHeader
        title={tool?.name ?? "Tool"}
        action={
          !loading &&
          tool && (
            <button
              type="button"
              onClick={toggleFavorite}
              disabled={favoriting}
              aria-label={favoriteId ? "Remove from favorites" : "Add to favorites"}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center disabled:opacity-50"
            >
              <svg aria-hidden="true"
                viewBox="0 0 24 24"
                fill={favoriteId ? "#E8491F" : "none"}
                stroke={favoriteId ? "#E8491F" : "#7C8087"}
                strokeWidth="2"
                className="h-5 w-5"
              >
                <path d="M12 20s-7-4.4-9.5-8.8C.7 8 2 4.5 5.5 4a5 5 0 0 1 6.5 2 5 5 0 0 1 6.5-2c3.5.5 4.8 4 3 7.2C19 15.6 12 20 12 20z" />
              </svg>
            </button>
          )
        }
      />

      <div className="px-4 py-4">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && error && <p className="mb-3 text-sm text-signal">{error}</p>}

        {!loading && tool && (
          <>
            <PhotoGallery photos={tool.photos} />
            <h1 className="mb-1 font-condensed text-xl font-bold uppercase text-asphalt">{tool.name}</h1>

            {/* Every list in the app shows a status pill; the detail screen —
                the one place someone reads before deciding to ask — did not.
                You had to infer "borrowed" from the absence of a Request
                button. `paused` is surfaced as its own state because the row
                still says "available" underneath. */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 font-mono text-[0.625rem] font-semibold uppercase tracking-wide ${
                  tool.paused ? "bg-[#EEECE8] text-steel" : statusStyle(tool.status)
                }`}
              >
                {tool.paused ? "Paused" : statusLabel(tool.status)}
              </span>
              {onLoanUntil && (
                <span className="font-mono text-[0.688rem] text-muted">{onLoanUntil}</span>
              )}
            </div>
            <div className="mb-4 flex items-center gap-2">
              {isOwner ? (
                <p className="text-sm font-semibold text-ink">{tool.profiles?.display_name ?? "Unknown owner"}</p>
              ) : (
                <div ref={ownerMenuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={ownerMenuOpen}
                    onClick={() => setOwnerMenuOpen((v) => !v)}
                    className="text-sm font-semibold text-ink underline decoration-dotted"
                  >
                    {tool.profiles?.display_name ?? "Unknown owner"}
                  </button>
                  {ownerMenuOpen && (
                    <div
                      role="menu"
                      aria-label={`Options for ${tool.profiles?.display_name ?? "this owner"}`}
                      className="absolute left-0 top-full z-40 w-36 overflow-hidden rounded-lg border border-cardBorder bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={startingChat}
                        onClick={startChat}
                        className="block w-full px-3.5 py-2.5 text-left text-[0.75rem] font-semibold text-asphalt disabled:opacity-50"
                      >
                        {startingChat ? "Starting…" : "Start Chat"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOwnerMenuOpen(false);
                          setReportOpen(true);
                        }}
                        className="block w-full px-3.5 py-2.5 text-left text-[0.75rem] font-semibold text-signal"
                      >
                        Report User
                      </button>
                    </div>
                  )}
                </div>
              )}
              {chestCount > 0 && (
                <Link
                  to={`/chest/${tool.chest_id}`}
                  className="flex items-center gap-1 text-[0.688rem] font-semibold text-racing"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <rect x="3" y="9" width="18" height="8" rx="1" />
                    <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
                  </svg>
                  {chestCount} more
                </Link>
              )}
              {tool.profiles?.approx_lat != null && tool.profiles?.approx_lng != null && !tool.profiles?.map_pin_hidden && (
                <Link
                  to={`/?view=map&focusType=tool&focusId=${tool.id}`}
                  className="flex items-center gap-1 text-[0.688rem] font-semibold text-racing"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                  View on map
                </Link>
              )}
            </div>
            {!isOwner && reportOpen && (
              <ReportUserButton
                reportedId={tool.chest_id}
                reportedName={tool.profiles?.display_name}
                toolId={tool.id}
                open={reportOpen}
                onClose={() => setReportOpen(false)}
                className="mb-3 block"
              />
            )}
            <dl className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
              {tool.condition && (
                <div>
                  <dt className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">Condition</dt>
                  <dd className="text-sm font-semibold text-asphalt">{CONDITION_LABEL[tool.condition] ?? tool.condition}</dd>
                </div>
              )}
              {tool.brand && (
                <div>
                  <dt className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">Brand</dt>
                  <dd className="text-sm font-semibold text-asphalt">{tool.brand}</dd>
                </div>
              )}
              {readSpecs(tool.specs).map((spec) => (
                <div key={spec.label}>
                  <dt className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">{spec.label}</dt>
                  <dd className="text-sm font-semibold text-asphalt">{spec.value}</dd>
                </div>
              ))}
              {categoryLabel(tool.category, tool.subcategory) && (
                <div>
                  <dt className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">Category</dt>
                  <dd className="text-sm font-semibold text-asphalt">{categoryLabel(tool.category, tool.subcategory)}</dd>
                </div>
              )}
            </dl>

            {/* Listings created before 0026_listing_fields.sql have a free-text
                description; the form no longer asks for one, but the ones that
                exist are still worth showing. */}
            {tool.description && (
              <p className="mb-4 text-sm leading-relaxed text-ink">{tool.description}</p>
            )}

            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[0.594rem] uppercase tracking-wide text-muted">Price</p>
                <p className="text-sm font-bold text-asphalt">{formatPrice(tool)}</p>
              </div>
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[0.594rem] uppercase tracking-wide text-muted">Access</p>
                <p className="text-sm font-bold text-asphalt">
                  {tool.portable ? "Portable" : `Stationary${tool.supervised_required ? " · Supervised" : ""}`}
                </p>
              </div>
            </div>

            {/* For sale — the asking price is deliberately not public
                (0021_tool_for_sale.sql): a buyer sees the flag and inquires
                via chat instead of a posted price. The owner sees their own
                price back, via get_asking_price(). */}
            {tool.for_sale && (
              <div className="mb-4 rounded-lg border border-[#8B6F1F]/25 bg-[#8B6F1F]/5 p-3">
                <p className="mb-1 font-mono text-[0.594rem] uppercase tracking-wide text-[#8B6F1F]">Also open to sell</p>
                {isOwner ? (
                  <p className="text-sm font-semibold text-asphalt">
                    {askingPrice != null ? `Asking price: $${Number(askingPrice).toFixed(2)}` : "No price set — buyers will need to inquire."}
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.719rem] leading-relaxed text-ink">Message the owner to ask about price and details.</p>
                    <button
                      type="button"
                      disabled={startingChat}
                      onClick={startChat}
                      className="flex-shrink-0 rounded-md bg-asphalt px-3 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                    >
                      {startingChat ? "…" : "Inquire"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pickup — a handshake, not an automatic reveal (0035). Four
                states, and the borrower is only ever shown the one they are
                actually in:
                  approved, not asked   -> "Request pickup"
                  asked, not answered   -> waiting
                  answered              -> the location
                  anything else         -> what it takes to get there */}
            {pickupLocation ? (
              <div className="mb-4 rounded-lg border border-[#B5602A]/25 bg-[#B5602A]/5 p-3">
                <p className="mb-1 font-mono text-[0.594rem] uppercase tracking-wide text-[#8A4A1F]">Pickup location</p>
                <p className="text-sm font-semibold text-asphalt">{pickupLocation}</p>
              </div>
            ) : !isOwner && myRequest?.status === "approved" && !myRequest.pickup_requested_at ? (
              <div className="mb-4 rounded-lg border border-[#B5602A]/25 bg-[#B5602A]/5 p-3">
                <p className="mb-1 font-mono text-[0.594rem] uppercase tracking-wide text-[#8A4A1F]">Ready to collect?</p>
                <p className="mb-2.5 text-xs leading-relaxed text-ink">
                  {tool.profiles?.display_name ?? "The owner"} approved your
                  request. Ask for pickup when you're ready and they'll share where to meet.
                </p>
                <button
                  type="button"
                  onClick={askForPickup}
                  disabled={askingPickup}
                  className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
                >
                  {askingPickup ? "Asking…" : "Request pickup"}
                </button>
              </div>
            ) : !isOwner && myRequest?.status === "approved" && myRequest.pickup_requested_at ? (
              <div className="mb-4 rounded-lg border border-dashed border-asphalt/20 bg-asphalt/5 p-3">
                <p className="mb-1 font-mono text-[0.594rem] uppercase tracking-wide text-muted">Pickup requested</p>
                <p className="text-xs leading-relaxed text-ink">
                  Waiting for {tool.profiles?.display_name ?? "the owner"} to
                  share where to meet. We'll notify you as soon as they do.
                </p>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-dashed border-asphalt/20 bg-asphalt/5 p-3">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#7C8087" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0">
                  <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                </svg>
                <p className="text-xs leading-relaxed text-ink">
                  <b>Pickup location</b> —{" "}
                  {userId
                    ? "shared by the owner once your request is approved and you ask to collect."
                    : "sign in, get approved, then ask to collect."}
                </p>
              </div>
            )}

            {/* Owner side of the same handshake. */}
            {isOwner && pickupAsks.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                  {pickupAsks.length} waiting on a pickup spot
                </p>
                {pickupAsks.map((ask) => (
                  <div key={ask.id} className="rounded-lg border border-[#B5602A]/25 bg-[#B5602A]/5 p-3">
                    <p className="mb-2 text-sm text-ink">
                      <b>{ask.borrower?.display_name ?? "A neighbor"}</b> is ready to collect.
                      Where should they meet you?
                    </p>

                    {pickupFormId === ask.id ? (
                      <>
                        <input
                          value={pickupSpot}
                          onChange={(e) => setPickupSpot(e.target.value)}
                          placeholder="e.g. the coffee shop on Main, Saturday morning"
                          className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => releasePickup(ask.id, false)}
                            disabled={savingPickup || !pickupSpot.trim()}
                            className="flex-1 rounded-lg bg-asphalt py-2.5 text-sm font-bold uppercase text-safety disabled:opacity-40"
                          >
                            {savingPickup ? "Sharing…" : "Share this"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPickupFormId(null);
                              setPickupSpot("");
                            }}
                            disabled={savingPickup}
                            className="flex-1 rounded-lg border border-steelLight py-2.5 text-sm font-bold uppercase text-ink disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => releasePickup(ask.id, true)}
                          disabled={savingPickup}
                          className="flex-1 rounded-lg bg-asphalt py-2.5 text-sm font-bold uppercase text-safety disabled:opacity-40"
                        >
                          Use saved address
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPickupFormId(ask.id);
                            setPickupSpot("");
                          }}
                          disabled={savingPickup}
                          className="flex-1 rounded-lg border border-asphalt py-2.5 text-sm font-bold uppercase text-asphalt disabled:opacity-40"
                        >
                          Set a spot
                        </button>
                      </div>
                    )}

                    <p className="mt-2 text-[0.688rem] leading-relaxed text-muted">
                      "Set a spot" shares that place with this borrower only, and leaves your
                      listing's address untouched.
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Contact — same reveal-on-approval rule as pickup location, so the
                borrower can actually reach the owner to arrange a time. Chat is
                the primary path now; email/phone stays as a fallback for
                people who'd rather just call. */}
            {ownerContact && (
              <div className="mb-4 rounded-lg border border-cardBorder bg-white p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="font-mono text-[0.594rem] uppercase tracking-wide text-muted">
                    Contact {ownerContact.display_name ?? "the owner"}
                  </p>
                  {myRequest?.status === "approved" && (
                    <Link to={`/requests/${myRequest.id}/chat`} className="text-[0.688rem] font-semibold text-racing">
                      Message
                    </Link>
                  )}
                </div>
                <p className="text-sm font-semibold text-asphalt">{ownerContact.email}</p>
                {ownerContact.phone && <p className="text-sm font-semibold text-asphalt">{ownerContact.phone}</p>}
              </div>
            )}

            {isOwner && incomingRequests.length === 0 && (
              <p className="rounded-lg bg-asphalt/5 py-3 text-center text-sm font-semibold text-ink">This is your tool</p>
            )}

            {isOwner && incomingRequests.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                  {incomingRequests.length} pending request{incomingRequests.length === 1 ? "" : "s"}
                </p>
                {incomingRequests.map((r) => (
                  <div key={r.id} className="rounded-lg border border-cardBorder bg-white p-3">
                    <p className="mb-1 text-[0.781rem] leading-snug text-asphalt">
                      <b>{r.borrower?.display_name ?? "Someone"}</b> wants to borrow this
                    </p>

                    {/* The vetting signal that already existed in the schema and
                        was invisible at the only moment it matters. Sharing a
                        group means somebody approved them into it. */}
                    {sharedGroups[r.borrower_id]?.length > 0 && (
                      <p className="mb-1.5 flex flex-wrap items-center gap-1 text-[0.688rem] text-muted">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#2E6B2E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                        </svg>
                        Also in {sharedGroups[r.borrower_id].join(", ")}
                      </p>
                    )}

                    {r.message && (
                      <p className="mb-1.5 rounded-md border-l-2 border-cardBorder bg-asphalt/5 px-2 py-1.5 text-[0.719rem] italic leading-relaxed text-ink">
                        "{r.message}"
                      </p>
                    )}

                    {r.wants_instruction && (
                      <p className="mb-1.5 text-[0.688rem] text-muted">Asked for a quick walkthrough</p>
                    )}

                    {/* Deciding on a stranger with no way to ask them anything
                        was the gap. start_conversation has always allowed this;
                        it just was not reachable from the request. */}
                    <button
                      type="button"
                      onClick={() => messageBorrower(r.borrower_id)}
                      disabled={messagingId === r.borrower_id}
                      className="mb-1.5 text-[0.688rem] font-semibold text-racing disabled:opacity-50"
                    >
                      {messagingId === r.borrower_id ? "Opening…" : "Introduce yourself or ask a question"}
                    </button>
                    {denyingId === r.id ? (
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
                            disabled={decidingId === r.id}
                            onClick={() => decideIncoming(r.id, false, denyReason)}
                            className="rounded-md bg-asphalt px-3 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                          >
                            {decidingId === r.id ? "…" : "Confirm Deny"}
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
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={decidingId === r.id}
                          onClick={() => decideIncoming(r.id, true)}
                          className="rounded-md bg-asphalt px-3 py-1.5 text-[0.688rem] font-bold text-safety disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={decidingId === r.id}
                          onClick={() => {
                            setDenyingId(r.id);
                            setDenyReason("");
                          }}
                          className="rounded-md border border-steelLight px-3 py-1.5 text-[0.688rem] font-bold text-ink disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!isOwner && myRequest?.status === "pending" && (
              <p className="rounded-lg bg-[#FCF1D6] py-3 text-center text-sm font-semibold text-[#8A6300]">
                Request pending — waiting on {tool.profiles?.display_name ?? "the owner"}
              </p>
            )}

            {!isOwner && myRequest?.status === "denied" && (
              <div className="rounded-lg bg-[#FCEBEB] px-3 py-3 text-center">
                <p className="text-sm font-semibold text-signal">This request was declined</p>
                {myRequest.denial_reason && (
                  <p className="mt-1 text-[0.719rem] italic text-signal/80">"{myRequest.denial_reason}"</p>
                )}
              </div>
            )}

            {!isOwner && canRequestAgain(myRequest) && isAvailable && (
              <>
                {userId && !needsOnboarding && (
                  <div className="mb-3">
                    <label htmlFor="borrow-days" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                      How long do you need it?
                    </label>
                    <div className="flex w-40 items-center rounded-lg border border-cardBorder bg-white pr-3">
                      <input
                        id="borrow-days"
                        type="number"
                        min="1"
                        max="365"
                        value={borrowDays}
                        onChange={(e) => setBorrowDays(e.target.value)}
                        placeholder="7"
                        className="w-full bg-transparent px-3 py-2.5 text-sm text-asphalt outline-none"
                      />
                      <span className="text-sm font-semibold text-muted">days</span>
                    </div>
                    <p className="mt-1 text-[0.688rem] text-muted">The owner can adjust this when they approve.</p>
                  </div>
                )}
                {userId && !needsOnboarding && (
                  <div className="mb-3">
                    <label htmlFor="borrow-message" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
                      Add a note <span className="normal-case text-[#B0AEA6]">(optional)</span>
                    </label>
                    <textarea
                      id="borrow-message"
                      value={requestMessage}
                      onChange={(e) => setRequestMessage(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="e.g. Putting up a shelf Saturday — back to you Sunday"
                      className="w-full resize-none rounded-lg border border-cardBorder bg-white px-3 py-2 text-sm text-asphalt outline-none"
                    />
                    <p className="mt-1 text-[0.688rem] leading-relaxed text-muted">
                      {tool.profiles?.display_name ?? "The owner"} may not know you. A line about
                      what you need it for helps them say yes.
                    </p>
                  </div>
                )}
                {userId && !needsOnboarding && (
                  <label className="mb-3 flex items-center gap-2 text-[0.719rem] text-ink">
                    <input type="checkbox" checked={wantsInstruction} onChange={(e) => setWantsInstruction(e.target.checked)} />
                    I'd like a quick walkthrough on using this tool
                  </label>
                )}
                <button
                  type="button"
                  onClick={handleRequest}
                  disabled={requesting}
                  className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
                >
                  {requesting
                    ? "Requesting…"
                    : !userId
                      ? "Sign in to Request"
                      : needsOnboarding
                        ? "Finish Setup to Request"
                        : "Request Borrow"}
                </button>
              </>
            )}

            {!isOwner && canRequestAgain(myRequest) && !isAvailable && (
              <div className="rounded-lg bg-asphalt/5 py-3 text-center text-sm font-semibold text-ink">
                {/* The return date used to repeat here. It now sits in the
                    status row at the top of the screen, which is both higher
                    up and where every other list in the app puts it. */}
                <p>Currently unavailable</p>
              </div>
            )}

            {!isOwner && myRequest?.status === "approved" && (
              <div className="rounded-lg bg-[#E9F3E9] py-3 text-center text-sm font-semibold text-[#2E6B2E]">
                <p>Approved — coordinate pickup with {tool.profiles?.display_name ?? "the owner"}</p>
                {myRequest?.due_at && (
                  <p className="mt-0.5 font-mono text-[0.688rem] font-normal text-[#2E6B2E]">Due back {formatDueDate(myRequest.due_at)}</p>
                )}
                <Link to={`/requests/${myRequest.id}/chat`} className="mt-1 inline-block underline">
                  Open chat
                </Link>
                <button
                  type="button"
                  onClick={markReturned}
                  disabled={completing}
                  className="mt-2 block w-full underline disabled:opacity-50"
                >
                  {completing ? "Marking returned…" : "Mark tool returned"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

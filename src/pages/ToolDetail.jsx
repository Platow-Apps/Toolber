import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, logEvent } from "../lib/analytics";
import { formatPrice } from "../lib/toolStatus";
import { useAuth } from "../contexts/AuthContext";
import { useDismissableMenu } from "../lib/useDismissableMenu";
import ReportUserButton from "../components/ReportUserButton";
import PhotoGallery from "../components/PhotoGallery";

const SELECT_COLUMNS =
  "id, name, category, kind, description, status, monetize, price, price_duration_unit, for_sale, paused, portable, supervised_required, chest_id, photos, profiles(display_name, approx_lat, approx_lng, map_pin_hidden)";

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
  const [requesting, setRequesting] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);
  const [favoriting, setFavoriting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]); // pending requests on this tool, owner-only
  const [decidingId, setDecidingId] = useState(null);
  const [denyingId, setDenyingId] = useState(null);
  const [denyReason, setDenyReason] = useState("");
  const [startingChat, setStartingChat] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [askingPrice, setAskingPrice] = useState(null); // owner's own reveal only, via get_asking_price()
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
            .select("id, status, wants_instruction, requested_at, denial_reason")
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
    setMyRequest(reqData ?? null);
    setFavoriteId(favData?.id ?? null);

    // Owner sees who's asking, right here — clicking your own "Requested"
    // tool used to just say "This is your tool" with no way to act on it.
    if (userId && toolData.chest_id === userId) {
      const { data: incoming } = await supabase
        .from("borrow_requests")
        .select("id, status, wants_instruction, requested_at, borrower:profiles!borrow_requests_borrower_id_fkey(display_name)")
        .eq("tool_id", id)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      setIncomingRequests(incoming ?? []);

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
      setAskingPrice(null);
    }

    if (reqData?.status === "approved") {
      const [{ data: loc, error: locErr }, { data: contact }] = await Promise.all([
        supabase.rpc("get_pickup_location", { p_tool_id: id }),
        supabase.rpc("get_borrow_contact", { p_request_id: reqData.id }),
      ]);
      if (locErr) setError(locErr.message);
      setPickupLocation(loc ?? null);
      setOwnerContact(contact?.[0] ?? null);
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

  async function handleRequest() {
    if (!userId) return signInFirst();
    if (needsOnboarding) return finishOnboardingFirst();
    setRequesting(true);
    setError("");
    const { error } = await supabase.rpc("request_borrow", {
      p_tool_id: id,
      p_wants_instruction: wantsInstruction,
    });
    setRequesting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await logEvent(userId, EVENTS.BORROW_REQUESTED, { tool_id: id });
    await load();
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

  return (
    <div className="pb-6">
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
          {tool?.name ?? "Tool"}
        </p>
        {!loading && tool && (
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
        )}
      </div>

      <div className="px-4 py-4">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && error && <p className="mb-3 text-sm text-signal">{error}</p>}

        {!loading && tool && (
          <>
            <PhotoGallery photos={tool.photos} />
            <h1 className="mb-1 font-condensed text-xl font-bold uppercase text-asphalt">{tool.name}</h1>
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
            <p className="mb-4 text-sm leading-relaxed text-ink">{tool.description}</p>

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

            {/* Pickup location — locked until approved, matches the "Unified rule" in Location & Privacy Model */}
            {pickupLocation ? (
              <div className="mb-4 rounded-lg border border-[#B5602A]/25 bg-[#B5602A]/5 p-3">
                <p className="mb-1 font-mono text-[0.594rem] uppercase tracking-wide text-[#8A4A1F]">Pickup location</p>
                <p className="text-sm font-semibold text-asphalt">{pickupLocation}</p>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-dashed border-asphalt/20 bg-asphalt/5 p-3">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#7C8087" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0">
                  <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                </svg>
                <p className="text-xs leading-relaxed text-ink">
                  <b>Pickup location</b> —{" "}
                  {userId ? "revealed once your request is approved." : "sign in and get approved to see this."}
                </p>
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
                    Contact {ownerContact.display_name?.split(" ")[0] ?? "the owner"}
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
                    {r.wants_instruction && (
                      <p className="mb-1.5 text-[0.688rem] text-muted">Asked for a quick walkthrough</p>
                    )}
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
                Request pending — waiting on {tool.profiles?.display_name?.split(" ")[0] ?? "the owner"}
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

            {!isOwner && (!myRequest || myRequest.status === "denied") && isAvailable && (
              <>
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

            {!isOwner && !myRequest && !isAvailable && (
              <p className="rounded-lg bg-asphalt/5 py-3 text-center text-sm font-semibold text-ink">Currently unavailable</p>
            )}

            {!isOwner && myRequest?.status === "approved" && (
              <div className="rounded-lg bg-[#E9F3E9] py-3 text-center text-sm font-semibold text-[#2E6B2E]">
                <p>Approved — coordinate pickup with {tool.profiles?.display_name?.split(" ")[0] ?? "the owner"}</p>
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

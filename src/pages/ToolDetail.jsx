import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const SELECT_COLUMNS =
  "id, name, category, kind, description, status, monetize, price, price_duration_unit, portable, supervised_required, crib_id, profiles(display_name)";

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tool, setTool] = useState(null);
  const [myRequest, setMyRequest] = useState(null); // most recent borrow_requests row by me, for this tool
  const [pickupLocation, setPickupLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wantsInstruction, setWantsInstruction] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);
  const [favoriting, setFavoriting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: toolData, error: toolErr }, { data: reqData }, { data: favData }] = await Promise.all([
      supabase.from("tools").select(SELECT_COLUMNS).eq("id", id).single(),
      supabase
        .from("borrow_requests")
        .select("id, status, wants_instruction, requested_at")
        .eq("tool_id", id)
        .eq("borrower_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("favorites").select("id").eq("tool_id", id).eq("profile_id", user.id).maybeSingle(),
    ]);

    if (toolErr) {
      setError(toolErr.message);
      setLoading(false);
      return;
    }
    setTool(toolData);
    setMyRequest(reqData ?? null);
    setFavoriteId(favData?.id ?? null);

    if (reqData?.status === "approved") {
      const { data: loc } = await supabase.rpc("get_pickup_location", { p_tool_id: id });
      setPickupLocation(loc ?? null);
    } else {
      setPickupLocation(null);
    }

    setLoading(false);
  }, [id, user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRequest() {
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
    await supabase.from("events").insert({ profile_id: user.id, event_type: "borrow_requested", metadata: { tool_id: id } });
    await load();
  }

  async function toggleFavorite() {
    setFavoriting(true);
    if (favoriteId) {
      const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
      if (!error) setFavoriteId(null);
    } else {
      const { data, error } = await supabase
        .from("favorites")
        .insert({ profile_id: user.id, tool_id: id })
        .select("id")
        .single();
      if (!error) {
        setFavoriteId(data.id);
        await supabase.from("events").insert({ profile_id: user.id, event_type: "favorite_added", metadata: { tool_id: id } });
      }
    }
    setFavoriting(false);
  }

  const isOwner = tool?.crib_id === user.id;

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2.5 bg-asphalt px-4 py-3.5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
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
            <svg
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
            <h1 className="mb-1 font-condensed text-xl font-bold uppercase text-asphalt">{tool.name}</h1>
            <p className="mb-4 text-sm font-semibold text-ink">{tool.profiles?.display_name ?? "Unknown owner"}</p>
            <p className="mb-4 text-sm leading-relaxed text-ink">{tool.description}</p>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted">Price</p>
                <p className="text-sm font-bold text-asphalt">
                  {tool.monetize ? `$${tool.price} / ${tool.price_duration_unit?.replace("_", " ")}` : "Free"}
                </p>
              </div>
              <div className="rounded-lg border border-cardBorder bg-white p-2.5">
                <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted">Access</p>
                <p className="text-sm font-bold text-asphalt">
                  {tool.portable ? "Portable" : `Stationary${tool.supervised_required ? " · Supervised" : ""}`}
                </p>
              </div>
            </div>

            {/* Pickup location — locked until approved, matches the "Unified rule" in Location & Privacy Model */}
            {pickupLocation ? (
              <div className="mb-4 rounded-lg border border-[#B5602A]/25 bg-[#B5602A]/5 p-3">
                <p className="mb-1 font-mono text-[9.5px] uppercase tracking-wide text-[#8A4A1F]">Pickup location</p>
                <p className="text-sm font-semibold text-asphalt">{pickupLocation}</p>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-dashed border-asphalt/20 bg-asphalt/5 p-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="#7C8087" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0">
                  <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                </svg>
                <p className="text-xs leading-relaxed text-ink">
                  <b>Pickup location</b> — revealed once your request is approved.
                </p>
              </div>
            )}

            {isOwner && (
              <p className="rounded-lg bg-asphalt/5 py-3 text-center text-sm font-semibold text-ink">This is your tool</p>
            )}

            {!isOwner && myRequest?.status === "pending" && (
              <p className="rounded-lg bg-[#FCF1D6] py-3 text-center text-sm font-semibold text-[#8A6300]">
                Request pending — waiting on {tool.profiles?.display_name?.split(" ")[0] ?? "the owner"}
              </p>
            )}

            {!isOwner && myRequest?.status === "denied" && (
              <p className="rounded-lg bg-[#FCEEE8] py-3 text-center text-sm font-semibold text-signal">
                This request was declined
              </p>
            )}

            {!isOwner && (!myRequest || myRequest.status === "denied") && tool.status === "available" && (
              <>
                <label className="mb-3 flex items-center gap-2 text-[11.5px] text-ink">
                  <input type="checkbox" checked={wantsInstruction} onChange={(e) => setWantsInstruction(e.target.checked)} />
                  I'd like a quick walkthrough on using this tool
                </label>
                <button
                  type="button"
                  onClick={handleRequest}
                  disabled={requesting}
                  className="w-full rounded-lg bg-asphalt py-3 font-condensed text-sm font-bold uppercase tracking-wide text-safety disabled:opacity-50"
                >
                  {requesting ? "Requesting…" : "Request Borrow"}
                </button>
              </>
            )}

            {!isOwner && !myRequest && tool.status !== "available" && (
              <p className="rounded-lg bg-asphalt/5 py-3 text-center text-sm font-semibold text-ink">Currently unavailable</p>
            )}

            {!isOwner && myRequest?.status === "approved" && (
              <p className="rounded-lg bg-[#E9F3E9] py-3 text-center text-sm font-semibold text-[#2E6B2E]">
                Approved — coordinate pickup with {tool.profiles?.display_name?.split(" ")[0] ?? "the owner"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

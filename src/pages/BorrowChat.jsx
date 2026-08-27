import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

// Resolves a borrow request's "Message"/"Open chat" links to the general
// conversation between its two parties (0019_general_messaging.sql) and
// redirects there. Chat is no longer gated on the request being approved —
// any two registered users can already message each other — so this is
// purely a lookup: which two people, which existing (or new) conversation.
// Kept as its own route rather than changing every existing
// `/requests/:id/chat` link across MyTools/ToolDetail to call
// start_conversation() directly.
export default function BorrowChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: request, error: reqErr } = await supabase
        .from("borrow_requests")
        .select("id, borrower_id, lender_id")
        .eq("id", id)
        .single();

      if (cancelled) return;
      if (reqErr) {
        setError(reqErr.message);
        return;
      }

      const counterpartId = request.borrower_id === user.id ? request.lender_id : request.lender_id === user.id ? request.borrower_id : null;
      if (!counterpartId) {
        setError("Not a party to this request");
        return;
      }

      const { data: conversationId, error: startErr } = await supabase.rpc("start_conversation", {
        p_other_user_id: counterpartId,
      });

      if (cancelled) return;
      if (startErr) {
        setError(startErr.message);
        return;
      }

      navigate(`/messages/${conversationId}`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [id, user.id, navigate]);

  return (
    <div className="flex min-h-app items-center justify-center bg-page px-6">
      {error ? <p className="text-sm text-signal">{error}</p> : <p className="text-sm text-muted">Loading…</p>}
    </div>
  );
}

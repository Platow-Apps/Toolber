import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { useDismissableMenu } from "../lib/useDismissableMenu";
import { describeNotification } from "../lib/notifications";

const RECENT_LIMIT = 20;

function timeAgo(isoString) {
  const seconds = Math.max(0, (Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// In-app half of the "in-app + email together" notification design — email
// already existed (supabase/functions/notify), this was the missing half.
// Renders nothing for a signed-out visitor (Search is public, so this
// mounts there too). Lives in BrandBar, next to the nav-menu icon.
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { open, setOpen, ref } = useDismissableMenu();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let mounted = true;
    supabase
      .from("notifications")
      .select("id, type, payload, read_at, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (!error) setNotifications(data ?? []);
        setLoading(false);
      });

    // Realtime so a notification shows up live, not just on next page load —
    // the point of "in-app", not just "in the database".
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev].slice(0, RECENT_LIMIT));
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (!user) return null;

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function markRead(ids) {
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  }

  function openNotification(n) {
    setOpen(false);
    if (!n.read_at) markRead([n.id]);
    navigate(describeNotification(n).href);
  }

  async function dismiss(id) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  }

  async function clearAll() {
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    if (ids.length > 0) await supabase.from("notifications").delete().in("id", ids);
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-7 w-7 items-center justify-center"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#B7BCC2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[1.1rem] w-[1.1rem]">
          <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 13.5 6 9z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-redOrange px-0.5 font-mono text-[0.5rem] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 max-h-96 w-72 overflow-y-auto rounded-lg border border-panelBorder bg-panel py-1 shadow-lg"
        >
          <div className="flex items-center justify-between px-3.5 py-2">
            <span className="font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-steelLight">Notifications</span>
            <div className="flex items-center gap-2.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markRead(notifications.filter((n) => !n.read_at).map((n) => n.id))}
                  className="text-[0.688rem] font-semibold text-safety"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button type="button" onClick={clearAll} className="text-[0.688rem] font-semibold text-steel">
                  Clear all
                </button>
              )}
            </div>
          </div>

          {loading && <p className="px-3.5 py-4 text-center text-[0.75rem] text-steelLight">Loading…</p>}
          {!loading && notifications.length === 0 && (
            <p className="px-3.5 py-4 text-center text-[0.75rem] text-steelLight">Nothing yet.</p>
          )}

          {notifications.map((n) => {
            const { message } = describeNotification(n);
            return (
              <div key={n.id} className="flex items-start border-t border-panelBorder/60 first:border-t-0">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openNotification(n)}
                  className="flex flex-1 items-start gap-2 px-3.5 py-2.5 text-left"
                >
                  {!n.read_at && <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-redOrange" />}
                  <span className={n.read_at ? "ml-3.5" : ""}>
                    <span className="block text-[0.75rem] leading-snug text-steelLight">{message}</span>
                    <span className="mt-0.5 block font-mono text-[0.625rem] text-steel">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Clear notification"
                  onClick={() => dismiss(n.id)}
                  className="flex-shrink-0 px-2.5 py-2.5 text-steel"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

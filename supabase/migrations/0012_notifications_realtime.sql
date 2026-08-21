-- Adds `notifications` to Supabase's realtime publication so the new
-- in-app notification bell (src/components/NotificationBell.jsx) gets new
-- rows pushed live via postgres_changes, instead of only ever seeing them
-- on next page load. Security still comes from the existing
-- notifications_select_own RLS policy (0001_init.sql) -- Realtime evaluates
-- RLS per-connection using the caller's JWT, so a user's subscription only
-- ever receives their own rows regardless of the filter they request.

alter publication supabase_realtime add table notifications;

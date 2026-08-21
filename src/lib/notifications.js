// Human-readable copy + destination link per notification type, shared by
// NotificationBell. Deliberately generic (no tool/group *names*, just "one of
// your tools") — the payload only carries ids, matching the same copy style
// already shipped in supabase/functions/notify/index.ts's email templates,
// so in-app and email don't read as two different products.
const NOTIFICATION_COPY = {
  borrow_requested: {
    message: () => "Someone wants to borrow one of your tools.",
    href: () => "/my-tools",
  },
  borrow_approved: {
    message: () => "Your borrow request was approved — the pickup location is ready.",
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  borrow_denied: {
    message: (p) => (p?.reason ? `Your request was declined: "${p.reason}"` : "Your borrow request was declined."),
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  tool_malfunctioning: {
    message: () => "One of your tools was reported malfunctioning.",
    href: () => "/my-tools",
  },
  group_join_requested: {
    message: () => "Someone requested to join a group you administer.",
    href: (p) => (p?.group_id ? `/groups/${p.group_id}` : "/groups"),
  },
  group_join_approved: {
    message: () => "You're in! Your group join request was approved.",
    href: (p) => (p?.group_id ? `/groups/${p.group_id}` : "/groups"),
  },
  group_join_denied: {
    message: () => "Your group join request was declined.",
    href: () => "/groups",
  },
  new_message: {
    message: () => "You have a new message.",
    href: (p) => (p?.request_id ? `/requests/${p.request_id}/chat` : "/my-tools"),
  },
};

export function describeNotification(notification) {
  const entry = NOTIFICATION_COPY[notification.type];
  if (!entry) return { message: "You have a new notification.", href: "/" };
  return { message: entry.message(notification.payload), href: entry.href(notification.payload) };
}

// Human-readable copy + destination link per notification type, shared by
// NotificationBell. Deliberately generic (no tool/group *names*, just "one of
// your tools") — the payload only carries ids, matching the same copy style
// already shipped in supabase/functions/notify/index.ts's email templates,
// so in-app and email don't read as two different products.
const NOTIFICATION_COPY = {
  borrow_requested: {
    message: () => "Someone wants to borrow one of your tools.",
    // Straight to the tool, where the owner's Approve/Deny controls are —
    // /my-tools made them find the right listing among all of theirs first.
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  borrow_approved: {
    // Deliberately no longer says the location is ready: since
    // 0035_pickup_handshake.sql approval discloses nothing, and the borrower
    // has to ask before the owner shares a place.
    message: () => "Your borrow request was approved — request pickup when you're ready.",
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  pickup_requested: {
    message: () => "A borrower is ready to collect — share where to meet.",
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  pickup_ready: {
    message: () => "The pickup location is ready.",
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
    // conversation_id (0019_general_messaging.sql) is the current shape;
    // request_id is legacy (0013's request-scoped chat, superseded but the
    // /requests/:id/chat resolver still exists so old payloads still work).
    href: (p) => (p?.conversation_id ? `/messages/${p.conversation_id}` : p?.request_id ? `/requests/${p.request_id}/chat` : "/my-tools"),
  },
  borrow_tool_removed: {
    // The only notification that names its subject: the tool row is deleted
    // by the time this is read, so an id would resolve to nothing
    // (0024_loan_duration.sql).
    message: (p) =>
      p?.tool_name
        ? `Sorry — "${p.tool_name}" is no longer available for lending.`
        : "A tool you asked to borrow is no longer available.",
    href: () => "/",
  },
  borrow_overdue: {
    message: (p) =>
      p?.days_late > 1
        ? `A tool you borrowed was due back ${p.days_late} days ago.`
        : "A tool you borrowed is past its return date.",
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
  borrow_overdue_lender: {
    message: (p) =>
      p?.days_late > 1
        ? `A tool you lent out was due back ${p.days_late} days ago.`
        : "A tool you lent out is past its return date.",
    href: () => "/my-tools",
  },
  borrow_completed: {
    message: () => "A borrow was marked returned.",
    href: (p) => (p?.tool_id ? `/tool/${p.tool_id}` : "/my-tools"),
  },
};

export function describeNotification(notification) {
  const entry = NOTIFICATION_COPY[notification.type];
  if (!entry) return { message: "You have a new notification.", href: "/" };
  return { message: entry.message(notification.payload), href: entry.href(notification.payload) };
}

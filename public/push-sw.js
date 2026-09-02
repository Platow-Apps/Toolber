// Push handling, imported into the Workbox-generated service worker.
//
// vite-plugin-pwa runs in `generateSW` mode, so the service worker itself is
// generated at build time and there is no source file to add listeners to.
// `workbox.importScripts` is the supported seam: this file is served as a
// static asset from public/ and pulled into the generated worker. That is why
// it imports nothing — it is not bundled, and a bare `import` would break the
// worker outright.
//
// Keep it small. A throw at the top level of a service worker kills the whole
// worker, taking the offline precache with it.

/* global self, clients */

// Kept in step with src/lib/notifications.js and supabase/functions/push.
// Duplicated rather than shared because a service worker cannot import from
// the app bundle. This is only the fallback: the server sends `body` in the
// payload, and this table is what shows if that is ever missing.
const PUSH_COPY = {
  borrow_requested: "Someone wants to borrow one of your tools.",
  borrow_approved: "Your borrow request was approved.",
  borrow_denied: "Your borrow request was declined.",
  pickup_requested: "A borrower is ready to collect.",
  pickup_ready: "The pickup location is ready.",
  borrow_completed: "A borrow was marked returned.",
  borrow_overdue: "A tool you borrowed is past its return date.",
  borrow_overdue_lender: "A tool you lent out is past its return date.",
  tool_malfunctioning: "One of your tools was reported malfunctioning.",
  group_join_requested: "Someone asked to join a group you administer.",
  group_join_approved: "You're in! Your group join request was approved.",
  group_join_denied: "Your group join request was declined.",
  new_message: "You have a new message.",
};

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still produce a notification. A push event that
    // resolves without showing one makes some browsers display their own "This
    // site has been updated in the background" message instead, which is worse
    // than a generic line of our own.
    data = {};
  }

  const title = data.title || "Toolber";
  const body = data.body || PUSH_COPY[data.type] || "You have a new notification.";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Collapses repeats about the same subject rather than stacking them —
      // three overdue reminders for one tool should be one line, not three.
      tag: data.tag || data.type || "toolber",
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data?.url || "/"));
});

/**
 * Bring Toolber to the front, at the right page.
 *
 * Every step here is allowed to fail, because the first version assumed none
 * of them would and did nothing at all when one did.
 *
 * The specific trap: `client.navigate()` rejects for a client the service
 * worker does not control, and `includeUncontrolled: true` returns precisely
 * those clients. An unhandled rejection there meant focus() was never reached
 * and openWindow() was never tried, so tapping a notification silently did
 * nothing. A worker installed after a tab was already open controls nothing
 * in it, which makes that the common case rather than the rare one.
 *
 * So: focus first — bringing the app forward is the part that must not fail —
 * then try to navigate, and fall back to opening a fresh window if any of it
 * goes wrong.
 */
async function openTarget(target) {
  const url = new URL(target, self.location.origin).href;

  let windowClients = [];
  try {
    windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {
    // Leave it empty and open a new window below.
  }

  for (const client of windowClients) {
    if (!client.url.startsWith(self.location.origin)) continue;
    try {
      if ("focus" in client) await client.focus();
      // Already there — focusing was the whole job.
      if (client.url === url) return;
      if ("navigate" in client) await client.navigate(url);
      return;
    } catch {
      // Uncontrolled client, or a browser that refuses either call. Stop
      // trying to reuse this window and open a clean one instead.
      break;
    }
  }

  try {
    if (clients.openWindow) await clients.openWindow(url);
  } catch {
    // Nothing further we can do from here.
  }
}

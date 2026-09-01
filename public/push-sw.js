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
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // Focus a tab that is already open rather than piling up new ones. The
      // origin check keeps this to our own windows.
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.navigate(target);
          return client.focus();
        }
      }

      return clients.openWindow ? clients.openWindow(target) : undefined;
    })()
  );
});

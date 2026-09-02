import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "ava";

/**
 * The service worker's push handling, exercised directly.
 *
 * `public/push-sw.js` is a plain script pulled into the Workbox-generated
 * worker by `importScripts`. Nothing imports it, so nothing tested it — and it
 * is the only code here that runs with no DOM, no bundler, and no way to
 * observe a failure short of a neighbor saying their phone did nothing. Both
 * bugs it has had were exactly that shape.
 *
 * So it is loaded into a fresh VM context with `self` and `clients` stubbed,
 * which is close enough to a worker's global scope for the handlers to run.
 */

const SOURCE = fs.readFileSync(path.resolve("public/push-sw.js"), "utf8");
const ORIGIN = "https://toolber.org";

function loadWorker({ clients: windowClients = [], matchAllThrows = false } = {}) {
  const listeners = {};
  const calls = { focused: [], navigated: [], opened: [], shown: [], closed: 0 };

  const clients = {
    matchAll: async () => {
      if (matchAllThrows) throw new Error("matchAll unavailable");
      return windowClients.map((spec) => ({
        url: spec.url,
        focus: async () => {
          if (spec.focusThrows) throw new Error("cannot focus");
          calls.focused.push(spec.url);
        },
        // What actually happens for a client the worker does not control.
        navigate: async (to) => {
          if (spec.navigateThrows) throw new Error("not controlled by this service worker");
          calls.navigated.push(to);
        },
      }));
    },
    openWindow: async (url) => {
      calls.opened.push(url);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    registration: {
      showNotification: async (title, options) => {
        calls.shown.push({ title, options });
      },
    },
  };

  vm.runInContext(SOURCE, vm.createContext({ self, clients, URL, console }));
  return { listeners, calls };
}

/** Fire notificationclick and await whatever it handed to waitUntil. */
async function click(worker, url) {
  let pending;
  worker.listeners.notificationclick({
    notification: {
      data: url === undefined ? undefined : { url },
      close: () => {
        worker.calls.closed++;
      },
    },
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;
}

/** Fire push and await the same. */
async function push(worker, payload) {
  let pending;
  worker.listeners.push({
    data: payload === undefined ? null : { json: () => payload },
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;
}

// ── notificationclick ───────────────────────────────────────────────────────

test("opens a window when the app is not running", async (t) => {
  const worker = loadWorker();
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.opened, [`${ORIGIN}/tool/t1`]);
});

test("focuses an open window rather than piling up new ones", async (t) => {
  const worker = loadWorker({ clients: [{ url: `${ORIGIN}/` }] });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.focused, [`${ORIGIN}/`]);
  t.deepEqual(worker.calls.navigated, [`${ORIGIN}/tool/t1`]);
  t.is(worker.calls.opened.length, 0);
});

test("does not navigate a window that is already on the target page", async (t) => {
  const worker = loadWorker({ clients: [{ url: `${ORIGIN}/tool/t1` }] });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.focused, [`${ORIGIN}/tool/t1`]);
  t.is(worker.calls.navigated.length, 0);
});

test("still brings the app forward when navigate is refused", async (t) => {
  // The bug this replaced: navigate() rejects for a client the worker does not
  // control, and matchAll deliberately returns those. The unhandled rejection
  // meant focus was never reached and no window was ever opened — tapping the
  // notification did nothing whatsoever.
  const worker = loadWorker({ clients: [{ url: `${ORIGIN}/`, navigateThrows: true }] });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.focused, [`${ORIGIN}/`], "the app must still come to the front");
  t.deepEqual(worker.calls.opened, [`${ORIGIN}/tool/t1`], "and a usable window must open");
});

test("opens a window when even focus is refused", async (t) => {
  const worker = loadWorker({ clients: [{ url: `${ORIGIN}/`, focusThrows: true }] });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.opened, [`${ORIGIN}/tool/t1`]);
});

test("opens a window when the client list cannot be read", async (t) => {
  const worker = loadWorker({ matchAllThrows: true });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.deepEqual(worker.calls.opened, [`${ORIGIN}/tool/t1`]);
});

test("ignores windows belonging to another origin", async (t) => {
  const worker = loadWorker({ clients: [{ url: "https://example.com/" }] });
  await click(worker, `${ORIGIN}/tool/t1`);

  t.is(worker.calls.focused.length, 0);
  t.deepEqual(worker.calls.opened, [`${ORIGIN}/tool/t1`]);
});

test("falls back to the home page when the payload carries no url", async (t) => {
  const worker = loadWorker();
  await click(worker, undefined);

  t.deepEqual(worker.calls.opened, [`${ORIGIN}/`]);
});

test("closes the notification that was tapped", async (t) => {
  const worker = loadWorker();
  await click(worker, `${ORIGIN}/`);

  t.is(worker.calls.closed, 1);
});

// ── push ────────────────────────────────────────────────────────────────────

test("shows what the server sent", async (t) => {
  const worker = loadWorker();
  await push(worker, { title: "Toolber", body: "Someone wants your saw.", type: "borrow_requested" });

  t.is(worker.calls.shown[0].title, "Toolber");
  t.is(worker.calls.shown[0].options.body, "Someone wants your saw.");
});

test("falls back to its own copy when the payload has no body", async (t) => {
  const worker = loadWorker();
  await push(worker, { type: "pickup_ready" });

  t.regex(worker.calls.shown[0].options.body, /pickup location is ready/i);
});

test("still shows something for a payload it cannot read", async (t) => {
  // A push event that resolves without showing a notification makes some
  // browsers display their own "site updated in the background" message, which
  // is worse than a generic line of ours.
  const worker = loadWorker();
  let pending;
  worker.listeners.push({
    data: {
      json: () => {
        throw new Error("not json");
      },
    },
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;

  t.is(worker.calls.shown.length, 1);
  t.truthy(worker.calls.shown[0].options.body);
});

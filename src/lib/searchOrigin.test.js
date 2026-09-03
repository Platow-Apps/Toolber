import test from "ava";
import { describeLocateFailure, watchDevice } from "./searchOrigin.js";

/** Stand in for navigator.geolocation, and record what was asked of it. */
function stubGeolocation({ positions = [], error = null } = {}) {
  const calls = { cleared: [], watchIds: [] };
  let nextId = 1;
  globalThis.navigator.geolocation = {
    watchPosition(onOk, onErr) {
      const id = nextId++;
      calls.watchIds.push(id);
      if (error) onErr(error);
      for (const p of positions) onOk({ coords: p });
      return id;
    },
    clearWatch(id) {
      calls.cleared.push(id);
    },
  };
  return calls;
}

test.afterEach(() => {
  delete globalThis.navigator.geolocation;
});

test.serial("reports each position it is given", (t) => {
  stubGeolocation({
    positions: [
      { latitude: 45.677, longitude: -111.0429, accuracy: 12 },
      { latitude: 45.678, longitude: -111.0431, accuracy: 8 },
    ],
  });

  const seen = [];
  watchDevice((pos) => seen.push(pos));

  t.deepEqual(seen, [
    { lat: 45.677, lng: -111.0429, accuracy: 12 },
    { lat: 45.678, lng: -111.0431, accuracy: 8 },
  ]);
});

test.serial("stops watching when told to", (t) => {
  // watchPosition runs until cleared and costs real battery, so leaving the
  // map has to end it. A leak here is invisible and expensive.
  const calls = stubGeolocation();

  const stop = watchDevice(() => {});
  stop();

  t.deepEqual(calls.cleared, calls.watchIds);
});

test.serial("names a denied permission as denied", (t) => {
  // The one failure that cannot be retried: once refused, no script can raise
  // the prompt again.
  stubGeolocation({ error: { code: 1 } });

  let reason = null;
  watchDevice(() => {}, (r) => { reason = r; });

  t.is(reason, "denied");
  t.regex(describeLocateFailure(reason), /site settings/i);
});

test.serial("tells a timeout apart from an outright failure", (t) => {
  stubGeolocation({ error: { code: 3 } });
  let reason = null;
  watchDevice(() => {}, (r) => { reason = r; });
  t.is(reason, "timeout");

  delete globalThis.navigator.geolocation;
  stubGeolocation({ error: { code: 2 } });
  watchDevice(() => {}, (r) => { reason = r; });
  t.is(reason, "unavailable");
});

test.serial("says so, and hands back a no-op, where the browser cannot locate", (t) => {
  let reason = null;
  const stop = watchDevice(() => {}, (r) => { reason = r; });

  t.is(reason, "unsupported");
  t.notThrows(() => stop(), "stopping a watch that never started must be safe");
});

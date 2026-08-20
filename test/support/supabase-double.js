// Stand-in for `src/lib/supabaseClient.js` in tests.
//
// `mock-supabase.mjs` installs a resolve hook that points every import of the
// real client module at this file, so components keep their `import { supabase }
// from "../lib/supabaseClient"` line untouched while tests drive the responses.

import { makeMockClient } from "./supabase-mock.js";

let current = makeMockClient();

/** Replace the active stub. Returns the handle (fromCalls, rpcCalls, …). */
export function setSupabaseMock(config = {}) {
  current = makeMockClient(config);
  return current;
}

/** The handle for the currently-installed stub. */
export function getSupabaseMock() {
  return current;
}

/** Reset to a stub that answers everything with `{ data: null, error: null }`. */
export function resetSupabaseMock() {
  current = makeMockClient();
  return current;
}

// A live proxy rather than a fixed object: `setSupabaseMock()` swaps the
// backing client between tests, and every module that already imported
// `supabase` keeps working against the new one.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      return current.client[prop];
    },
    has(_target, prop) {
      return prop in current.client;
    },
  }
);

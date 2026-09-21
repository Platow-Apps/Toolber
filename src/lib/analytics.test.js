import test from "ava";
// The double directly rather than test/setup.jsx: this is a lib test with no
// component to render, and setup.jsx pulls in Testing Library's cleanup
// machinery, which holds the worker open after the assertions are done.
import "../../test/support/polyfills.js";
import { setSupabaseMock } from "../../test/support/supabase-double.js";
import { EVENTS, logEvent } from "./analytics.js";

// The signed-in path is exercised all over the page suites, which assert that
// each action logs its row. What none of them can see is the signed-out half
// added by 0065: whether an anonymous visit is recorded at all, and — the part
// that is easy to get wrong — whether it is recorded *twice* for somebody whose
// session had simply not finished restoring yet.

test.beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // jsdom always has it; a real private window might not, and the code under
    // test is written for that.
  }
});

test.serial("a signed-in event is a direct insert, not the visitor RPC", async (t) => {
  const mock = setSupabaseMock({ session: null });

  await logEvent("profile-1", EVENTS.SEARCH_PERFORMED, { query: "ladder" });

  t.is(mock.rpcCalls.length, 0);
  const insert = mock.fromCalls.find((c) => c.table === "events");
  t.truthy(insert);
  t.deepEqual(insert.builder.argsFor("insert")[0], {
    profile_id: "profile-1",
    event_type: "search_performed",
    metadata: { query: "ladder" },
  });
});

test.serial("a signed-out search reaches log_visitor_event with typed arguments", async (t) => {
  const mock = setSupabaseMock({ session: null });

  await logEvent(null, EVENTS.SEARCH_PERFORMED, { query: "ladder", results: 3, near: true });

  t.is(mock.fromCalls.filter((c) => c.table === "events").length, 0, "never a direct insert");
  t.is(mock.rpcCalls.length, 1);
  const { name, args } = mock.rpcCalls[0];
  t.is(name, "log_visitor_event");
  t.is(args.p_event_type, "search_performed");
  t.is(args.p_query, "ladder");
  t.is(args.p_results, 3);
  t.true(args.p_near);
  t.is(args.p_tool_id, null);
  // Not asserted for its value, only that one is always sent: the RPC refuses
  // a null session, so a client that stopped sending one would log nothing and
  // say nothing about it.
  t.truthy(args.p_session);
});

test.serial("one session id for the whole visit, so views do not read as visitors", async (t) => {
  const mock = setSupabaseMock({ session: null });

  await logEvent(null, EVENTS.TOOL_VIEWED, { tool_id: "tool-1" });
  await logEvent(null, EVENTS.TOOL_VIEWED, { tool_id: "tool-2" });

  t.is(mock.rpcCalls.length, 2);
  t.is(mock.rpcCalls[0].args.p_session, mock.rpcCalls[1].args.p_session);
});

test.serial("an event outside the public two is dropped rather than sent", async (t) => {
  const mock = setSupabaseMock({ session: null });

  await logEvent(null, EVENTS.BORROW_REQUESTED, { tool_id: "tool-1" });

  t.is(mock.rpcCalls.length, 0);
  t.is(mock.fromCalls.length, 0);
});

test.serial("a restoring session logs nothing anonymously", async (t) => {
  // The case this guards: a public page renders once before the JWT arrives,
  // with userId still null. Logging then and again on the attributed re-render
  // counts one visit twice, in two different populations.
  const mock = setSupabaseMock({ session: { user: { id: "profile-1" } } });

  await logEvent(null, EVENTS.TOOL_VIEWED, { tool_id: "tool-1" });

  t.is(mock.rpcCalls.length, 0);
  t.is(mock.fromCalls.length, 0);
});

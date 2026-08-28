import test from "ava";
import { describeJoinResult, joinCreatedRequest } from "./joinStatus.js";

test("distinguishes a new request from one that was ignored", (t) => {
  // The whole point of audit LOGIC-5: these used to be indistinguishable,
  // because the RPC returned NULL on conflict and the UI only checked `error`.
  t.true(joinCreatedRequest("requested"));
  t.false(joinCreatedRequest("already_pending"));
  t.false(joinCreatedRequest("already_approved"));
  t.false(joinCreatedRequest("already_denied"));
});

test("does not tell someone their request was sent when it wasn't", (t) => {
  t.is(describeJoinResult("requested"), "Request sent.");
  for (const status of ["already_pending", "already_approved", "already_denied"]) {
    t.not(describeJoinResult(status), "Request sent.", status);
    t.true(describeJoinResult(status).length > 0, status);
  }
});

test("says a previously denied request was declined, rather than staying silent", (t) => {
  t.regex(describeJoinResult("already_denied"), /declined/i);
});

test("falls back to success copy for a status it doesn't recognise", (t) => {
  // A future status value reaching an older client should read as the common
  // case, not as an empty string.
  t.is(describeJoinResult("something_new"), "Request sent.");
  t.is(describeJoinResult(null), "Request sent.");
  t.is(describeJoinResult(undefined), "Request sent.");
});

test("treats an unrecognised status as not-created, so it isn't logged as a join", (t) => {
  t.false(joinCreatedRequest(null));
  t.false(joinCreatedRequest("something_new"));
});

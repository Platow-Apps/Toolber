import test from "ava";
import { canRequestAgain, formatDueDate, formatOnLoanUntil, isOverdue } from "./toolStatus.js";

// ─── Loan windows (0024_loan_duration.sql) ───────────────────────────

test("says nothing about a loan window unless the tool is actually out", (t) => {
  // due_at can outlive the loan that set it, so status is what decides
  // whether there is anything to say.
  t.is(formatOnLoanUntil({ status: "available", due_at: "2099-09-04T18:00:00Z" }), null);
  t.is(formatOnLoanUntil({ status: "borrowed", due_at: null }), null);
  t.is(formatOnLoanUntil(null), null);
});

test("degrades to no line rather than 'Invalid Date' on a malformed due_at", (t) => {
  t.is(formatOnLoanUntil({ status: "borrowed", due_at: "not-a-date" }), null);
  t.is(formatDueDate("not-a-date"), null);
  t.is(formatDueDate(null), null);
});

test("renders a real due date as a short day label", (t) => {
  const line = formatOnLoanUntil({ status: "borrowed", due_at: "2099-09-04T18:00:00Z" });
  t.regex(line, /^On lend until [A-Z][a-z]{2} \d{1,2}$/);
});

test("only calls a loan overdue once its date has actually passed", (t) => {
  t.true(isOverdue({ status: "borrowed", due_at: "2020-01-02T00:00:00Z" }));
  t.false(isOverdue({ status: "borrowed", due_at: "2099-01-02T00:00:00Z" }));
  // Not out on loan at all, so it cannot be overdue whatever the date says.
  t.false(isOverdue({ status: "available", due_at: "2020-01-02T00:00:00Z" }));
  t.false(isOverdue({ status: "borrowed", due_at: null }));
});

test("a fresh visitor with no history can request", (t) => {
  t.true(canRequestAgain(null));
  t.true(canRequestAgain(undefined));
});

test("a live request blocks a second one", (t) => {
  // Two open requests for the same tool from the same person is a duplicate,
  // not a second borrow.
  t.false(canRequestAgain({ status: "pending" }));
  t.false(canRequestAgain({ status: "approved" }));
});

test("borrowing the same tool twice is allowed, which is the whole point", (t) => {
  // Completing a loan used to remove the Request button permanently: the
  // screen reads only the most recent request, and only "none" or "denied"
  // offered the button. On a tool-lending app, borrowing the same ladder
  // again in the spring is the expected case, not an edge case.
  t.true(canRequestAgain({ status: "completed" }));
});

test("withdrawing a request does not bar you from asking again", (t) => {
  t.true(canRequestAgain({ status: "cancelled" }));
});

test("a declined request can still be re-sent", (t) => {
  t.true(canRequestAgain({ status: "denied" }));
});

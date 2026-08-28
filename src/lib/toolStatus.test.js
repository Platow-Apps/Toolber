import test from "ava";
import { formatDueDate, formatOnLoanUntil, isOverdue } from "./toolStatus.js";

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

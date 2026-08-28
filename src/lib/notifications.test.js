import test from "ava";
import { describeNotification } from "./notifications.js";

test("falls back to generic copy for a type it has never seen", (t) => {
  // New notification types are added in migrations, which can reach a browser
  // running older JS. That must degrade to something readable, not crash the
  // whole notification list.
  const { message, href } = describeNotification({ type: "invented_later", payload: {} });
  t.is(message, "You have a new notification.");
  t.is(href, "/");
});

test("survives a notification with no payload at all", (t) => {
  for (const type of ["borrow_approved", "borrow_overdue", "borrow_tool_removed", "new_message"]) {
    const { message, href } = describeNotification({ type, payload: null });
    t.true(typeof message === "string" && message.length > 0, type);
    t.true(typeof href === "string" && href.startsWith("/"), type);
  }
});

test("names the removed tool, since its id no longer resolves to anything", (t) => {
  t.is(
    describeNotification({ type: "borrow_tool_removed", payload: { tool_name: "Wet tile saw" } }).message,
    'Sorry — "Wet tile saw" is no longer available for lending.'
  );
});

test("pluralises an overdue loan by how late it actually is", (t) => {
  const oneDay = describeNotification({ type: "borrow_overdue", payload: { days_late: 1 } });
  t.is(oneDay.message, "A tool you borrowed is past its return date.");

  const later = describeNotification({ type: "borrow_overdue", payload: { days_late: 6 } });
  t.is(later.message, "A tool you borrowed was due back 6 days ago.");
});

test("tells the lender and the borrower different things about the same loan", (t) => {
  const payload = { days_late: 4, tool_id: "tool-1" };
  const borrower = describeNotification({ type: "borrow_overdue", payload });
  const lender = describeNotification({ type: "borrow_overdue_lender", payload });

  t.regex(borrower.message, /you borrowed/);
  t.regex(lender.message, /you lent out/);
  // The borrower is sent to the tool; the lender to the screen that has the
  // "mark returned" control.
  t.is(borrower.href, "/tool/tool-1");
  t.is(lender.href, "/my-tools");
});

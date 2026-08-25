import test from "ava";
import { cleanup, fireEvent, flush, renderPage, screen, TEST_USER_ID } from "../../test/setup.jsx";
import ReportUserButton from "./ReportUserButton.jsx";

test.afterEach(() => {
  cleanup();
});

function render(props = {}) {
  return renderPage(
    <ReportUserButton reportedId="other-1" reportedName="Jim B." requestId="req-1" toolId="tool-1" {...props} />
  );
}

test.serial("renders nothing for a signed-out visitor", async (t) => {
  await renderPage(<ReportUserButton reportedId="other-1" reportedName="Jim B." />, { session: null, profile: null });
  t.is(screen.queryByText(/report/i), null);
});

test.serial("renders nothing when the reported user is yourself", async (t) => {
  await render({ reportedId: TEST_USER_ID });
  t.is(screen.queryByText(/report/i), null);
});

test.serial("renders nothing without a reportedId", async (t) => {
  await render({ reportedId: null });
  t.is(screen.queryByText(/report/i), null);
});

test.serial("opens a reason field on click, closed by default", async (t) => {
  await render();
  t.is(screen.queryByPlaceholderText(/what happened/i), null);

  fireEvent.click(screen.getByRole("button", { name: /report jim b\./i }));
  t.truthy(screen.getByPlaceholderText(/what happened/i));
});

test.serial("cancel closes the form without sending a report", async (t) => {
  const { mock } = await render();
  fireEvent.click(screen.getByRole("button", { name: /report jim b\./i }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  t.is(screen.queryByPlaceholderText(/what happened/i), null);
  t.false(mock.tablesTouched().includes("user_reports"));
});

test.serial("send is disabled until a reason is typed", async (t) => {
  await render();
  fireEvent.click(screen.getByRole("button", { name: /report jim b\./i }));

  t.true(screen.getByRole("button", { name: "Send Report" }).disabled);
});

test.serial("submits the report with reporter/reported/context and logs the event", async (t) => {
  const { mock } = await render();
  fireEvent.click(screen.getByRole("button", { name: /report jim b\./i }));

  fireEvent.change(screen.getByPlaceholderText(/what happened/i), { target: { value: "Was rude at pickup" } });
  fireEvent.click(screen.getByRole("button", { name: "Send Report" }));
  await flush();

  const insert = mock.findBuilder("user_reports", "insert");
  t.deepEqual(insert.argsFor("insert")[0], {
    reporter_id: TEST_USER_ID,
    reported_id: "other-1",
    reason: "Was rude at pickup",
    context_request_id: "req-1",
    context_tool_id: "tool-1",
  });
  t.truthy(mock.eventLogged("user_reported"));
  t.truthy(screen.getByText(/report sent/i));
});

test.serial("surfaces a submit failure instead of pretending it worked", async (t) => {
  await renderPage(<ReportUserButton reportedId="other-1" reportedName="Jim B." />, {
    supabase: { tables: { user_reports: { data: null, error: { message: "permission denied" } } } },
  });
  fireEvent.click(screen.getByRole("button", { name: /report jim b\./i }));
  fireEvent.change(screen.getByPlaceholderText(/what happened/i), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Send Report" }));
  await flush();

  t.truthy(screen.getByText("permission denied"));
});

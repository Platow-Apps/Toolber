import test from "ava";
import { Route, Routes } from "react-router-dom";
import { cleanup, flush, MockQueryBuilder, renderPage, screen, TEST_USER_ID } from "../../test/setup.jsx";
import BorrowChat from "./BorrowChat.jsx";

test.afterEach(() => {
  cleanup();
});

const OTHER_ID = "22222222-2222-2222-2222-222222222222";

const REQUEST = { id: "req-1", borrower_id: TEST_USER_ID, lender_id: OTHER_ID };

function app() {
  return (
    <Routes>
      <Route path="/requests/:id/chat" element={<BorrowChat />} />
      <Route path="/messages/:conversationId" element={<div data-testid="conversation">chat screen</div>} />
    </Routes>
  );
}

function render({ request = REQUEST, requestError = null, rpc } = {}) {
  return renderPage(app(), {
    route: "/requests/req-1/chat",
    supabase: {
      from: (table) =>
        table === "borrow_requests"
          ? new MockQueryBuilder({ data: requestError ? null : request, error: requestError })
          : new MockQueryBuilder({ data: null, error: null }),
      rpc,
    },
  });
}

test.serial("resolves the counterpart from the request and redirects to their conversation", async (t) => {
  const { mock } = await render({
    rpc: (name) => (name === "start_conversation" ? { data: "convo-1", error: null } : { data: null, error: null }),
  });
  await flush();

  t.truthy(screen.getByTestId("conversation"));
  t.deepEqual(mock.rpcCalls.find((c) => c.name === "start_conversation").args, { p_other_user_id: OTHER_ID });
});

test.serial("works from the lender's side too", async (t) => {
  const { mock } = await render({
    request: { id: "req-1", borrower_id: OTHER_ID, lender_id: TEST_USER_ID },
    rpc: () => ({ data: "convo-2", error: null }),
  });
  await flush();

  t.truthy(screen.getByTestId("conversation"));
  t.deepEqual(mock.rpcCalls.find((c) => c.name === "start_conversation").args, { p_other_user_id: OTHER_ID });
});

test.serial("surfaces a request-not-found error instead of redirecting", async (t) => {
  await render({ requestError: { message: "Request not found" } });
  await flush();

  t.truthy(screen.getByText("Request not found"));
  t.is(screen.queryByTestId("conversation"), null);
});

test.serial("blocks a non-participant without ever calling start_conversation", async (t) => {
  const { mock } = await render({ request: { id: "req-1", borrower_id: "someone-else", lender_id: "another-one" } });
  await flush();

  t.truthy(screen.getByText("Not a party to this request"));
  t.false(mock.rpcCalls.some((c) => c.name === "start_conversation"));
});

test.serial("surfaces a start_conversation failure", async (t) => {
  await render({ rpc: () => ({ data: null, error: { message: "Cannot start a conversation with yourself" } }) });
  await flush();

  t.truthy(screen.getByText("Cannot start a conversation with yourself"));
  t.is(screen.queryByTestId("conversation"), null);
});

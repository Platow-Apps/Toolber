import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  flush,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import BorrowChat from "./BorrowChat.jsx";

test.afterEach(() => {
  cleanup();
});

const OTHER_ID = "22222222-2222-2222-2222-222222222222";

const APPROVED_REQUEST = {
  id: "req-1",
  status: "approved",
  borrower_id: TEST_USER_ID,
  lender_id: OTHER_ID,
  tool: { name: "Ladder" },
  borrower: { display_name: "Test User" },
  lender: { display_name: "Jim B." },
};

const MESSAGES = [
  { id: "m-1", sender_id: OTHER_ID, body: "Hey, when works for pickup?", created_at: "2026-08-20T10:00:00Z" },
  { id: "m-2", sender_id: TEST_USER_ID, body: "How about Saturday morning?", created_at: "2026-08-20T10:05:00Z" },
];

function app() {
  return (
    <Routes>
      <Route path="/requests/:id/chat" element={<BorrowChat />} />
    </Routes>
  );
}

function render({ request = APPROVED_REQUEST, messages = MESSAGES, insertResult } = {}) {
  let messageReads = 0;
  return renderPage(app(), {
    route: "/requests/req-1/chat",
    supabase: {
      from: (table) => {
        if (table === "borrow_requests") return new MockQueryBuilder({ data: request, error: null });
        if (table === "borrow_messages") {
          // First call is the history read; a later call (send) is the insert
          // -- only the insert should see insertResult's shape.
          const isFirstRead = messageReads++ === 0;
          return new MockQueryBuilder(isFirstRead ? { data: messages, error: null } : (insertResult ?? { data: messages, error: null }));
        }
        return new MockQueryBuilder({ data: null, error: null });
      },
    },
  });
}

test.serial("renders the counterpart's name and tool, with messages in order", async (t) => {
  await render();

  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("Ladder"));
  t.truthy(screen.getByText("Hey, when works for pickup?"));
  t.truthy(screen.getByText("How about Saturday morning?"));
});

test.serial("shows an empty state when there's no history yet", async (t) => {
  await render({ messages: [] });

  t.truthy(screen.getByText(/no messages yet/i));
});

test.serial("blocks a non-participant", async (t) => {
  await render({ request: { ...APPROVED_REQUEST, borrower_id: "someone-else", lender_id: "another-one" } });

  t.truthy(screen.getByText(/only available to the borrower and lender/i));
  t.is(screen.queryByPlaceholderText(/message/i), null);
});

test.serial("blocks a pending (not-yet-approved) request", async (t) => {
  await render({ request: { ...APPROVED_REQUEST, status: "pending" } });

  t.truthy(screen.getByText(/only available to the borrower and lender/i));
});

test.serial("sending a message inserts a row and appends it to the list", async (t) => {
  const { mock } = await render({
    insertResult: { data: { id: "m-new", sender_id: TEST_USER_ID, body: "Sounds good!" }, error: null },
  });

  const input = screen.getByPlaceholderText(/message/i);
  fireEvent.change(input, { target: { value: "Sounds good!" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await flush();

  t.truthy(screen.getByText("Sounds good!"));
  const insertBuilder = mock.findBuilder("borrow_messages", "insert");
  t.deepEqual(insertBuilder.argsFor("insert")[0], {
    request_id: "req-1",
    sender_id: TEST_USER_ID,
    body: "Sounds good!",
  });
  t.is(input.value, "");
});

test.serial("a live realtime insert from the other party appears without a refetch", async (t) => {
  const { mock } = await render();

  act(() => {
    mock.emitRealtime("borrow_messages:req-1", {
      new: { id: "m-live", sender_id: OTHER_ID, body: "Actually, does Sunday work?", created_at: "2026-08-20T11:00:00Z" },
    });
  });
  await flush();

  t.truthy(screen.getByText("Actually, does Sunday work?"));
});

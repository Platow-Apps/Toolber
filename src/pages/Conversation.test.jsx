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
import Conversation from "./Conversation.jsx";

test.afterEach(() => {
  cleanup();
});

const OTHER_ID = "22222222-2222-2222-2222-222222222222";

const CONVERSATION = {
  id: "convo-1",
  participant_a_id: TEST_USER_ID,
  participant_b_id: OTHER_ID,
  participant_a: { display_name: "Test User" },
  participant_b: { display_name: "Jim B." },
};

const MESSAGES = [
  { id: "m-1", sender_id: OTHER_ID, body: "Hey, does the ladder still work?", created_at: "2026-08-20T10:00:00Z" },
  { id: "m-2", sender_id: TEST_USER_ID, body: "Yep, all good!", created_at: "2026-08-20T10:05:00Z" },
];

function app() {
  return (
    <Routes>
      <Route path="/messages/:conversationId" element={<Conversation />} />
    </Routes>
  );
}

function render({ conversation = CONVERSATION, conversationError = null, messages = MESSAGES, insertResult } = {}) {
  let messageReads = 0;
  return renderPage(app(), {
    route: "/messages/convo-1",
    supabase: {
      from: (table) => {
        if (table === "conversations") return new MockQueryBuilder({ data: conversationError ? null : conversation, error: conversationError });
        if (table === "conversation_messages") {
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

test.serial("renders the counterpart's name, with messages in order", async (t) => {
  await render();

  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("Hey, does the ladder still work?"));
  t.truthy(screen.getByText("Yep, all good!"));
});

test.serial("resolves the counterpart from whichever side of the pair I am", async (t) => {
  await render({
    conversation: { ...CONVERSATION, participant_a_id: OTHER_ID, participant_b_id: TEST_USER_ID, participant_a: { display_name: "Jim B." }, participant_b: { display_name: "Test User" } },
  });

  t.truthy(screen.getByText("Jim B."));
});

test.serial("shows an empty state when there's no history yet", async (t) => {
  await render({ messages: [] });

  t.truthy(screen.getByText(/no messages yet/i));
});

test.serial("surfaces a load error instead of a blank screen (e.g. a non-participant hitting RLS)", async (t) => {
  await render({ conversationError: { message: "JSON object requested, multiple (or no) rows returned" } });

  t.truthy(screen.getByText(/multiple \(or no\) rows returned/i));
  t.is(screen.queryByPlaceholderText(/message/i), null);
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
  const insertBuilder = mock.findBuilder("conversation_messages", "insert");
  t.deepEqual(insertBuilder.argsFor("insert")[0], {
    conversation_id: "convo-1",
    sender_id: TEST_USER_ID,
    body: "Sounds good!",
  });
  t.is(input.value, "");
});

test.serial("a live realtime insert from the other party appears without a refetch", async (t) => {
  const { mock } = await render();

  act(() => {
    mock.emitRealtime("conversation_messages:convo-1", {
      new: { id: "m-live", sender_id: OTHER_ID, body: "Actually, is it still available?", created_at: "2026-08-20T11:00:00Z" },
    });
  });
  await flush();

  t.truthy(screen.getByText("Actually, is it still available?"));
});

import test from "ava";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { flush, renderWithAuth, TEST_USER_ID } from "../../test/setup.jsx";
import GroupToolRequests from "./GroupToolRequests";

test.afterEach.always(cleanup);

const GROUP = "11111111-2222-3333-4444-555555555555";

const REQUESTS = [
  {
    id: "req-1",
    title: "Wet tile saw",
    details: "Retiling a small bathroom.",
    needed_by: "2026-10-01",
    status: "open",
    created_at: "2026-09-10T00:00:00Z",
    requester_id: "someone-else",
    requester_name: "Ana R.",
    reply_count: 1,
  },
];

const THREAD = [
  {
    id: "rep-1",
    body: "I've got one you can borrow.",
    created_at: "2026-09-10T01:00:00Z",
    responder_id: "jim",
    responder_name: "Jim B.",
    tool_id: "tool-9",
    tool_name: "Ridgid R4021",
  },
];

function render({ rpcs = {}, rpc, ...rest } = {}) {
  return renderWithAuth(<GroupToolRequests groupId={GROUP} userId={TEST_USER_ID} isGroupAdmin={false} />, {
    supabase: {
      rpcs: {
        group_tool_requests_for: { data: REQUESTS },
        group_tool_request_thread: { data: THREAD },
        ...rpcs,
      },
      rpc,
    },
    ...rest,
  });
}

test.serial("shows what the group is looking for", async (t) => {
  await render();
  await flush();

  t.truthy(screen.getByText("Wet tile saw"));
  t.truthy(screen.getByText("Retiling a small bathroom."));
  t.truthy(screen.getByText(/Ana R\./));
});

test.serial("an empty board explains why you would use it", async (t) => {
  // The blank state is the only place the idea gets explained: search already
  // told them nobody has one, so "no results" is exactly when to say that the
  // tool is probably in a garage nobody has listed.
  await render({ rpcs: { group_tool_requests_for: { data: [] } } });
  await flush();

  t.truthy(screen.getByText(/sitting in a garage/i));
});

test.serial("posting goes through the RPC that notifies the group", async (t) => {
  // Never a direct insert: the tables carry no INSERT grant precisely so the
  // notification cannot be skipped, and an ask nobody hears about is worse
  // than no ask.
  const { mock } = await render({ rpcs: { create_group_tool_request: { data: "new-req" } } });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /ask for a tool/i }));
  fireEvent.change(screen.getByLabelText(/what are you looking for/i), { target: { value: "Post hole digger" } });
  fireEvent.change(screen.getByLabelText(/anything else worth knowing/i), { target: { value: "Two fence posts." } });
  fireEvent.click(screen.getByRole("button", { name: /ask the group/i }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "create_group_tool_request").args, {
    p_group_id: GROUP,
    p_title: "Post hole digger",
    p_details: "Two fence posts.",
    p_needed_by: null,
  });
  t.is(mock.fromCalls.filter((c) => c.table.startsWith("group_tool_request")).length, 0);
});

test.serial("an empty ask is refused before it reaches the server", async (t) => {
  const { mock } = await render();
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /ask for a tool/i }));
  fireEvent.click(screen.getByRole("button", { name: /ask the group/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "create_group_tool_request").length, 0);
  t.truthy(screen.getByText(/say what you are looking for/i));
});

test.serial("opening a request shows the replies", async (t) => {
  await render();
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  t.truthy(screen.getByText("I've got one you can borrow."));
  t.truthy(screen.getByText(/Jim B\./));
});

test.serial("a reply that names a tool links straight to it", async (t) => {
  // The point of the tool reference: "I've got one" becomes something the
  // asker can act on, rather than a second conversation about where it is.
  await render();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  t.is(screen.getByRole("link", { name: /Ridgid R4021/ }).getAttribute("href"), "/tool/tool-9");
});

test.serial("replying sends the body and the offered listing", async (t) => {
  const { mock } = await render({ rpcs: { reply_to_group_tool_request: { data: "rep-2" } } });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  fireEvent.change(screen.getByLabelText(/reply to wet tile saw/i), { target: { value: "Mine is free Saturday." } });
  fireEvent.click(screen.getByRole("button", { name: /^reply$/i }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "reply_to_group_tool_request").args, {
    p_request_id: "req-1",
    p_body: "Mine is free Saturday.",
    p_tool_id: null,
  });
});

test.serial("a refused reply is shown rather than swallowed", async (t) => {
  await render({
    rpcs: { reply_to_group_tool_request: { data: null, error: { message: "That request is closed" } } },
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  fireEvent.change(screen.getByLabelText(/reply to wet tile saw/i), { target: { value: "Me too" } });
  fireEvent.click(screen.getByRole("button", { name: /^reply$/i }));
  await flush();

  t.truthy(screen.getByText(/That request is closed/));
});

test.serial("someone else's request offers you no way to close it", async (t) => {
  // Only the asker or the group admin, matching the RPC. Showing the control
  // to everyone would mean learning it does not work by clicking it.
  await render();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  t.is(screen.queryByRole("button", { name: /got one/i }), null);
  t.is(screen.queryByRole("button", { name: /withdraw/i }), null);
});

test.serial("your own request can be marked fulfilled", async (t) => {
  const { mock } = await render({
    rpcs: {
      group_tool_requests_for: { data: [{ ...REQUESTS[0], requester_id: TEST_USER_ID, requester_name: "Test User" }] },
      close_group_tool_request: { data: null },
    },
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /1 reply/i }));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /got one/i }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "close_group_tool_request").args, {
    p_request_id: "req-1",
    p_status: "fulfilled",
  });
});

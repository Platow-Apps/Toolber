import test from "ava";
import {
  cleanup,
  fireEvent,
  flush,
  MockQueryBuilder,
  renderPage,
  screen,
} from "../../test/setup.jsx";
import MyTools from "./MyTools.jsx";

test.afterEach(() => {
  cleanup();
});

const MY_TOOLS = [
  { id: "tool-1", name: "Circular saw", status: "available", monetize: false, price: null, price_duration_unit: null },
  { id: "tool-2", name: "Pressure washer", status: "borrowed", monetize: true, price: 20, price_duration_unit: "day" },
];

const INCOMING = [
  {
    id: "req-in",
    status: "pending",
    wants_instruction: true,
    requested_at: "2026-08-01T00:00:00Z",
    tool: { name: "Circular saw" },
    borrower: { display_name: "Ana R." },
  },
];

const OUTGOING = [
  {
    id: "req-out",
    status: "approved",
    requested_at: "2026-08-02T00:00:00Z",
    tool: { name: "Wet tile saw" },
    lender: { display_name: "Jim B." },
  },
];

/**
 * MyTools reads `borrow_requests` twice in one Promise.all — incoming first,
 * then outgoing — so the stub has to answer them in order.
 */
function render({ tools = MY_TOOLS, incoming = INCOMING, outgoing = OUTGOING, loans = [], rpc } = {}) {
  let requestReads = 0;
  let listingsLoansRead = false;
  return renderPage(<MyTools />, {
    route: "/my-tools",
    supabase: {
      from: (table) => {
        if (table === "tools") return new MockQueryBuilder({ data: tools, error: null });
        if (table === "borrow_requests") {
          if (!listingsLoansRead) {
            listingsLoansRead = true;
            return new MockQueryBuilder({ data: loans, error: null });
          }
          return new MockQueryBuilder({ data: requestReads++ === 0 ? incoming : outgoing, error: null });
        }
        return new MockQueryBuilder({ data: null, error: null });
      },
      rpc,
    },
  });
}

const requestsTab = () => screen.getByRole("button", { name: "Requests" });

// ─── My Listings ─────────────────────────────────────────────────────

test.serial("opens on My Listings", async (t) => {
  await render();

  t.truthy(screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Pressure washer"));
});

test.serial("scopes the listings query to the signed-in chest", async (t) => {
  const { mock } = await render();

  t.deepEqual(mock.builderFor("tools").argsFor("eq"), [
    "chest_id",
    "11111111-1111-1111-1111-111111111111",
  ]);
});

test.serial("never selects pickup_location for the listings view", async (t) => {
  const { mock } = await render();

  t.false(mock.builderFor("tools").argsFor("select")[0].includes("pickup_location"));
});

test.serial("shows each listing's status and price", async (t) => {
  await render();

  t.truthy(screen.getByText("Available"));
  t.truthy(screen.getByText("Borrowed"));
  t.truthy(screen.getByText("Free"));
  t.truthy(screen.getByText("$20.00/day"));
});

test.serial("prompts to add a first tool when the chest is empty", async (t) => {
  await render({ tools: [] });

  t.truthy(screen.getByText(/Nothing listed yet/i));
});

test.serial("links to the List a Tool form", async (t) => {
  await render();

  t.is(screen.getByText("List Something").closest("a").getAttribute("href"), "/my-tools/new");
});

// ─── Managing a listing ──────────────────────────────────────────────

const openMenu = (name) => fireEvent.click(screen.getByRole("button", { name: `Manage ${name}` }));

test.serial("marks a paused listing as hidden from search", async (t) => {
  await render({
    tools: [{ ...MY_TOOLS[0], paused: true }],
  });

  t.truthy(screen.getByText(/Paused — hidden from search/i));
});

test.serial("pausing a listing writes the flag and updates the row in place", async (t) => {
  const { mock } = await render();

  openMenu("Circular saw");
  fireEvent.click(screen.getByRole("button", { name: "Pause listing" }));
  await flush();

  t.deepEqual(mock.findBuilder("tools", "update").argsFor("update")[0], { paused: true });
  // Re-rendered from local state rather than a refetch, so the menu now
  // offers the inverse action.
  openMenu("Circular saw");
  t.truthy(screen.getByRole("button", { name: "Resume listing" }));
});

test.serial("deleting asks for confirmation first", async (t) => {
  const { mock } = await render();

  openMenu("Circular saw");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await flush();

  // Still nothing sent — the first Delete only opens the confirm step.
  t.is(mock.rpcCalls.filter((c) => c.name === "delete_tool").length, 0);
  t.truthy(screen.getByText(/This also removes its photos/i));
});

test.serial("confirming a delete calls delete_tool and drops the row", async (t) => {
  const { mock } = await render({ rpc: () => ({ data: ["chest-1/a.jpg"], error: null }) });

  openMenu("Circular saw");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "delete_tool").args, { p_tool_id: "tool-1" });
  t.is(screen.queryByText("Circular saw"), null);
  t.truthy(screen.getByText("Pressure washer"));
});

test.serial("surfaces the guard when a tool still has open requests, keeping it listed", async (t) => {
  await render({
    rpc: () => ({ data: null, error: { message: "This tool has 1 open request(s). Deny or mark them returned first." } }),
  });

  openMenu("Circular saw");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await flush();

  t.truthy(screen.getByText(/1 open request/i));
  t.truthy(screen.getByText("Circular saw"));
});

test.serial("offers an edit link per listing", async (t) => {
  await render();

  openMenu("Circular saw");
  t.truthy(screen.getByRole("button", { name: "Edit details" }));
});

// ─── Requests ────────────────────────────────────────────────────────

test.serial("shows incoming requests with the borrower and tool", async (t) => {
  await render();
  fireEvent.click(requestsTab());
  await flush();

  t.truthy(screen.getByText("Ana R."));
  t.truthy(screen.getByText("Circular saw"));
});

test.serial("flags a borrower who asked for a walkthrough", async (t) => {
  // wants_instruction is a convenience signal only — it must be visible to the
  // lender but must never gate approval.
  await render();
  fireEvent.click(requestsTab());
  await flush();

  t.truthy(screen.getByText("Asked for a quick walkthrough"));
});

test.serial("approves through the RPC rather than updating the row directly", async (t) => {
  const { mock } = await render();
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "approve_borrow_request").args,
    { p_request_id: "req-in", p_days: null }
  );
});

test.serial("denies through the RPC too, with an optional reason", async (t) => {
  // Deny is two-step: clicking "Deny" reveals an optional reason field
  // rather than firing the RPC immediately, so the lender has a chance to
  // explain before it's final.
  const { mock } = await render();
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  t.falsy(mock.rpcCalls.find((call) => call.name === "deny_borrow_request"));

  fireEvent.change(screen.getByPlaceholderText(/let them know why/i), { target: { value: "Already lent out" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm Deny" }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "deny_borrow_request").args,
    { p_request_id: "req-in", p_reason: "Already lent out" }
  );
});

test.serial("denying without typing a reason sends null, not an empty string", async (t) => {
  const { mock } = await render();
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Deny" }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "deny_borrow_request").args,
    { p_request_id: "req-in", p_reason: null }
  );
});

test.serial("cancelling a deny leaves the request pending with no RPC call", async (t) => {
  const { mock } = await render();
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await flush();

  t.falsy(mock.rpcCalls.find((call) => call.name === "deny_borrow_request"));
  t.truthy(screen.getByRole("button", { name: "Approve" }));
});

test.serial("offers no approve/deny buttons on an already-decided request", async (t) => {
  await render({ incoming: [{ ...INCOMING[0], status: "approved" }] });
  fireEvent.click(requestsTab());
  await flush();

  t.is(screen.queryByRole("button", { name: "Approve" }), null);
});

test.serial("lists outgoing requests with their status", async (t) => {
  await render();
  fireEvent.click(requestsTab());
  await flush();

  t.truthy(screen.getByText("Wet tile saw"));
  t.truthy(screen.getByText("approved"));
});

test.serial("shows empty states on both halves of the Requests tab", async (t) => {
  await render({ incoming: [], outgoing: [] });
  fireEvent.click(requestsTab());
  await flush();

  t.truthy(screen.getByText(/No requests on your tools yet/i));
  t.truthy(screen.getByText(/You haven't requested anything yet/i));
});

// ─── Loan durations (0024) ───────────────────────────────────────────

test.serial("shows a borrowed listing's return date on the card", async (t) => {
  await render({
    tools: [{ ...MY_TOOLS[1], status: "borrowed", due_at: "2099-09-04T00:00:00Z" }],
  });

  t.truthy(screen.getByText(/On lend until/i));
});

test.serial("flags a loan that is past its return date", async (t) => {
  await render({
    tools: [{ ...MY_TOOLS[1], status: "borrowed", due_at: "2020-01-02T00:00:00Z" }],
  });

  t.truthy(screen.getByText(/overdue/i));
});

test.serial("says nothing about a return date when the tool isn't out", async (t) => {
  // due_at can linger on a row whose status has moved on; the card keys off
  // status, so it must not claim a tool is on lend when it isn't.
  await render({
    tools: [{ ...MY_TOOLS[0], status: "available", due_at: "2099-09-04T00:00:00Z" }],
  });

  t.is(screen.queryByText(/On lend until/i), null);
});

test.serial("approves for the number of days the borrower asked for", async (t) => {
  const { mock } = await render({
    incoming: [{ ...INCOMING[0], requested_days: 3 }],
  });
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "approve_borrow_request").args, {
    p_request_id: "req-in",
    p_days: 3,
  });
});

test.serial("lets the owner shorten the loan before approving it", async (t) => {
  const { mock } = await render({
    incoming: [{ ...INCOMING[0], requested_days: 14 }],
  });
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.change(screen.getByLabelText("Days to lend for"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "approve_borrow_request").args, {
    p_request_id: "req-in",
    p_days: 2,
  });
});

test.serial("shows the agreed return date on an approved request", async (t) => {
  await render({
    outgoing: [{ ...OUTGOING[0], due_at: "2099-09-04T00:00:00Z" }],
  });
  fireEvent.click(requestsTab());
  await flush();

  t.truthy(screen.getByText(/Due back/i));
});

// "Mark returned" appears twice by design: inline on the card, and in the ⋮
// menu. The inline one is the version reachable without opening anything.
const returnLinks = () => screen.queryAllByRole("button", { name: /^Mark(ing)? returned/ });

test.serial("offers Mark returned only for a tool that is actually out", async (t) => {
  await render({
    tools: [
      { ...MY_TOOLS[0], id: "tool-1", status: "available" },
      { ...MY_TOOLS[1], id: "tool-2", status: "borrowed" },
    ],
    loans: [{ id: "req-live", tool_id: "tool-2" }],
  });

  // One inline link, for the borrowed tool only — no menu opened.
  t.is(returnLinks().length, 1);

  openMenu("Circular saw");
  t.is(returnLinks().length, 1, "the available tool's menu offers no return");
  fireEvent.keyDown(document, { key: "Escape" });

  openMenu("Pressure washer");
  t.is(returnLinks().length, 2, "the borrowed tool's menu offers one too");
});

test.serial("marking returned completes the borrow request that holds the tool", async (t) => {
  const { mock } = await render({
    tools: [{ ...MY_TOOLS[1], id: "tool-2", status: "borrowed" }],
    loans: [{ id: "req-live", tool_id: "tool-2" }],
  });

  fireEvent.click(returnLinks()[0]);
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "complete_borrow_request").args, {
    p_request_id: "req-live",
  });
});

test.serial("the menu's Mark returned completes the same request", async (t) => {
  const { mock } = await render({
    tools: [{ ...MY_TOOLS[1], id: "tool-2", status: "borrowed" }],
    loans: [{ id: "req-live", tool_id: "tool-2" }],
  });

  openMenu("Pressure washer");
  fireEvent.click(returnLinks()[1]);
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "complete_borrow_request").args, {
    p_request_id: "req-live",
  });
});

test.serial("surfaces a failed return rather than looking like it worked", async (t) => {
  await render({
    tools: [{ ...MY_TOOLS[1], id: "tool-2", status: "borrowed" }],
    loans: [{ id: "req-live", tool_id: "tool-2" }],
    rpc: () => ({ data: null, error: { message: "Only an approved request can be marked returned" } }),
  });

  fireEvent.click(returnLinks()[0]);
  await flush();

  t.truthy(screen.getByText(/Only an approved request can be marked returned/i));
});

// ── Withdrawing a request (audit RLS-2) ─────────────────────────────────

test.serial("lets a borrower withdraw a request that is still pending", async (t) => {
  // borrow_requests had no UPDATE policy and no cancel RPC, so the
  // 'cancelled' enum value was literally unreachable.
  const { mock } = await render({
    outgoing: [{ ...OUTGOING[0], id: "req-mine", status: "pending" }],
  });
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /withdraw request/i }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "cancel_borrow_request").args, {
    p_request_id: "req-mine",
  });
});

test.serial("offers no withdraw control once a request is approved", async (t) => {
  // An approved request is a real loan; ending that is "Mark tool returned".
  await render({ outgoing: [{ ...OUTGOING[0], status: "approved" }] });
  fireEvent.click(requestsTab());
  await flush();

  t.is(screen.queryByRole("button", { name: /withdraw request/i }), null);
});

test.serial("surfaces a refused withdrawal rather than looking like it worked", async (t) => {
  await render({
    outgoing: [{ ...OUTGOING[0], id: "req-mine", status: "pending" }],
    rpc: () => ({ data: null, error: { message: "Only a pending request can be cancelled" } }),
  });
  fireEvent.click(requestsTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /withdraw request/i }));
  await flush();

  t.truthy(screen.getByText(/Only a pending request can be cancelled/i));
});

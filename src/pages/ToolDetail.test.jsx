import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  makeProfile,
  fireEvent,
  flush,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import ToolDetail from "./ToolDetail.jsx";

test.afterEach(() => {
  cleanup();
});

const TOOL = {
  id: "tool-1",
  name: "Wet tile saw",
  category: "Cutting",
  kind: "single",
  description: "Ridgid R4021, blade is fresh",
  status: "available",
  monetize: false,
  price: null,
  price_duration_unit: null,
  portable: false,
  supervised_required: true,
  chest_id: "chest-1",
  profiles: { display_name: "Jim B.", approx_lat: 38.48, approx_lng: -122.75, map_pin_hidden: false },
};

function app() {
  return (
    <Routes>
      <Route path="/tool/:id" element={<ToolDetail />} />
      <Route path="/login" element={<div data-testid="login">login screen</div>} />
      <Route path="/onboarding" element={<div data-testid="onboarding">onboarding</div>} />
      <Route path="/messages/:conversationId" element={<div data-testid="conversation">chat screen</div>} />
    </Routes>
  );
}

/**
 * ToolDetail reads three tables in one Promise.all, so each needs its own
 * result rather than a single shared one.
 */
function render({ tool = TOOL, request = null, favorite = null, chestCount = 0, rpcs = {}, rpc, ...authOptions } = {}) {
  // The first read of `favorites` is the "am I already favouriting this?"
  // lookup; every later one is the insert/delete the heart button fires.
  let favoriteReads = 0;
  // `tools` is read twice per load: the listing itself, then a head-only
  // count of the owner's other listings for the chest link. One result serves
  // both — the row read takes .data, the count read takes .count.
  return renderPage(app(), {
    route: "/tool/tool-1",
    ...authOptions,
    supabase: {
      from: (table) => {
        if (table === "tools") return new MockQueryBuilder({ data: tool, error: null, count: chestCount });
        if (table === "borrow_requests") return new MockQueryBuilder({ data: request, error: null });
        if (table === "favorites") {
          const result = favoriteReads++ === 0 ? favorite : { id: "fav-new" };
          return new MockQueryBuilder({ data: result, error: null });
        }
        return new MockQueryBuilder({ data: null, error: null });
      },
      rpcs,
      rpc,
    },
  });
}

test.serial("renders the tool, its owner and its description", async (t) => {
  await render();

  t.truthy(screen.getByRole("heading", { name: "Wet tile saw" }));
  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("Ridgid R4021, blade is fresh"));
});

test.serial("describes a stationary supervised tool's access mode", async (t) => {
  await render();

  t.truthy(screen.getByText("Stationary · Supervised"));
});

test.serial("shows an Inquire button (not the price) for sale to a non-owner, which starts a chat", async (t) => {
  const { mock } = await render({
    tool: { ...TOOL, for_sale: true },
    rpc: (name) => (name === "start_conversation" ? { data: "convo-1", error: null } : { data: null, error: null }),
  });

  t.truthy(screen.getByText(/also open to sell/i));
  t.is(screen.queryByText(/\$/), null); // no price posted publicly

  fireEvent.click(screen.getByRole("button", { name: "Inquire" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "start_conversation").args, { p_other_user_id: "chest-1" });
  t.truthy(screen.getByTestId("conversation"));
});

test.serial("shows the owner their own asking price instead of an Inquire button", async (t) => {
  const { mock } = await render({
    tool: { ...TOOL, chest_id: TEST_USER_ID, for_sale: true },
    rpc: (name) => (name === "get_asking_price" ? { data: 125, error: null } : { data: null, error: null }),
  });
  await flush();

  t.truthy(screen.getByText("Asking price: $125.00"));
  t.is(screen.queryByRole("button", { name: "Inquire" }), null);
  t.deepEqual(mock.rpcCalls.find((c) => c.name === "get_asking_price").args, { p_tool_id: "tool-1" });
});

test.serial("tells the owner no price is set, rather than looking stuck loading, when they left it blank", async (t) => {
  await render({
    tool: { ...TOOL, chest_id: TEST_USER_ID, for_sale: true },
    rpc: (name) => (name === "get_asking_price" ? { data: null, error: null } : { data: null, error: null }),
  });
  await flush();

  t.truthy(screen.getByText(/no price set/i));
});

test.serial("clicking the owner offers Start Chat and Report User, and Start Chat starts a conversation", async (t) => {
  const { mock } = await render({ rpc: () => ({ data: "convo-1", error: null }) });

  fireEvent.click(screen.getByRole("button", { name: "Jim B." }));
  t.truthy(screen.getByRole("menuitem", { name: "Start Chat" }));
  t.truthy(screen.getByRole("menuitem", { name: "Report User" }));

  fireEvent.click(screen.getByRole("menuitem", { name: "Start Chat" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "start_conversation").args, { p_other_user_id: "chest-1" });
  t.truthy(screen.getByTestId("conversation"));
});

test.serial("Report User from the owner menu opens the report form", async (t) => {
  await render();

  fireEvent.click(screen.getByRole("button", { name: "Jim B." }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Report User" }));

  t.truthy(screen.getByPlaceholderText(/what happened/i));
});

test.serial("keeps the pickup location locked without an approved request", async (t) => {
  await render({ request: null });

  t.truthy(screen.getByText(/shared by the owner once your request is approved/i));
});

test.serial("does not call get_pickup_location without an approved request", async (t) => {
  const { mock } = await render({ request: { id: "r1", status: "pending" } });

  t.false(mock.rpcCalls.some((call) => call.name === "get_pickup_location"));
});

test.serial("approval alone offers pickup rather than handing over an address", async (t) => {
  // The point of the handshake: an approved borrower who has not asked to
  // collect gets a button, not a location, and the RPC is never called.
  const { mock } = await render({
    request: { id: "r1", status: "approved", pickup_requested_at: null, pickup_released_at: null },
    rpcs: { get_pickup_location: { data: "142 Birchwood Ct" } },
  });

  t.truthy(screen.getByRole("button", { name: /request pickup/i }));
  t.is(screen.queryByText("142 Birchwood Ct"), null);
  t.false(mock.rpcCalls.some((call) => call.name === "get_pickup_location"));
});

test.serial("asking for pickup calls the RPC and does not reveal anything yet", async (t) => {
  const { mock } = await render({
    request: { id: "r1", status: "approved", pickup_requested_at: null, pickup_released_at: null },
  });

  fireEvent.click(screen.getByRole("button", { name: /request pickup/i }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "request_pickup").args,
    { p_request_id: "r1" }
  );
});

test.serial("a borrower waiting on the owner is told so, not shown an error", async (t) => {
  await render({
    request: { id: "r1", status: "approved", pickup_requested_at: "2026-09-01T00:00:00Z", pickup_released_at: null },
  });

  t.truthy(screen.getByText(/waiting for .+ to share where to meet/i));
});

test.serial("reveals the pickup location once the owner has shared it", async (t) => {
  const { mock } = await render({
    request: {
      id: "r1",
      status: "approved",
      pickup_requested_at: "2026-09-01T00:00:00Z",
      pickup_released_at: "2026-09-01T01:00:00Z",
    },
    rpcs: { get_pickup_location: { data: "142 Birchwood Ct" } },
  });

  t.truthy(screen.getByText("142 Birchwood Ct"));
  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "get_pickup_location").args,
    { p_tool_id: "tool-1" }
  );
});

test.serial("never selects pickup_location directly from the tools table", async (t) => {
  const { mock } = await render();

  const columns = mock.builderFor("tools").argsFor("select")[0];
  t.false(columns.includes("pickup_location"));
});

test.serial("requests a borrow through the RPC, not a direct insert", async (t) => {
  const { mock } = await render();

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /request borrow/i }));
  await flush();

  const call = mock.rpcCalls.find((c) => c.name === "request_borrow");
  t.deepEqual(call.args, { p_tool_id: "tool-1", p_wants_instruction: true, p_days: null });
});

test.serial("logs an events row for a borrow request", async (t) => {
  // CLAUDE.md: every meaningful new action logs an events row — that is the
  // entire analytics strategy, so a missing one is invisible, not harmless.
  const { mock } = await render();

  fireEvent.click(screen.getByRole("button", { name: /request borrow/i }));
  await flush();

  t.deepEqual(mock.eventLogged("borrow_requested"), {
    profile_id: TEST_USER_ID,
    event_type: "borrow_requested",
    metadata: { tool_id: "tool-1" },
  });
});

test.serial("surfaces an RPC rejection instead of pretending it worked", async (t) => {
  await render({ rpc: () => ({ data: null, error: { message: "Cannot request your own tool" } }) });

  fireEvent.click(screen.getByRole("button", { name: /request borrow/i }));
  await flush();

  t.truthy(screen.getByText("Cannot request your own tool"));
});

test.serial("hides the request button on your own tool", async (t) => {
  await render({ tool: { ...TOOL, chest_id: TEST_USER_ID } });

  t.truthy(screen.getByText("This is your tool"));
  t.is(screen.queryByRole("button", { name: /request borrow/i }), null);
});

test.serial("shows who's requesting your own tool and lets you approve right there", async (t) => {
  // borrow_requests is read twice per load() when you own the tool: your own
  // (nonexistent) request first, then the tool's incoming pending requests —
  // standalone renderPage rather than the shared render() helper so this can
  // answer those two calls differently without touching every other test.
  let borrowRequestCalls = 0;
  const { mock } = await renderPage(app(), {
    route: "/tool/tool-1",
    supabase: {
      from: (table) => {
        if (table === "tools") return new MockQueryBuilder({ data: { ...TOOL, chest_id: TEST_USER_ID }, error: null });
        if (table === "borrow_requests") {
          const isIncomingCall = borrowRequestCalls % 2 === 1;
          borrowRequestCalls++;
          return new MockQueryBuilder({
            data: isIncomingCall
              ? [{ id: "req-in", status: "pending", wants_instruction: false, borrower: { display_name: "Ana R." } }]
              : null,
            error: null,
          });
        }
        return new MockQueryBuilder({ data: null, error: null });
      },
      rpcs: { approve_borrow_request: { data: null, error: null } },
    },
  });

  t.truthy(screen.getByText("Ana R."));
  t.is(screen.queryByText("This is your tool"), null);

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "approve_borrow_request").args, { p_request_id: "req-in" });
});

test.serial("shows a pending request instead of a second request button", async (t) => {
  await render({ request: { id: "r1", status: "pending" } });

  t.truthy(screen.getByText(/Request pending/i));
  t.is(screen.queryByRole("button", { name: /request borrow/i }), null);
});

test.serial("lets a denied request be re-sent", async (t) => {
  await render({ request: { id: "r1", status: "denied" } });

  t.truthy(screen.getByText("This request was declined"));
  t.truthy(screen.getByRole("button", { name: /request borrow/i }));
});

test.serial("blocks requesting a tool that is not available", async (t) => {
  await render({ tool: { ...TOOL, status: "borrowed" } });

  t.truthy(screen.getByText("Currently unavailable"));
  t.is(screen.queryByRole("button", { name: /request borrow/i }), null);
});

test.serial("adds a favorite and logs it", async (t) => {
  const { mock } = await render({ favorite: null });

  fireEvent.click(screen.getByLabelText("Add to favorites"));
  await flush();

  t.deepEqual(mock.builderFor("favorites", 1).argsFor("insert")[0], {
    profile_id: TEST_USER_ID,
    tool_id: "tool-1",
  });
  t.truthy(mock.eventLogged("favorite_added"));
});

test.serial("removes an existing favorite", async (t) => {
  const { mock } = await render({ favorite: { id: "fav-1" } });

  fireEvent.click(screen.getByLabelText("Remove from favorites"));
  await flush();

  const remover = mock.builderFor("favorites", 1);
  t.true(remover.called("delete"));
  t.deepEqual(remover.argsFor("eq"), ["id", "fav-1"]);
});

test.serial("offers a map link only when the owner has a visible pin", async (t) => {
  await render();
  t.is(screen.getByText("View on map").closest("a").getAttribute("href"), "/?view=map&focusType=tool&focusId=tool-1");

  cleanup();

  await render({ tool: { ...TOOL, profiles: { ...TOOL.profiles, map_pin_hidden: true } } });
  t.is(screen.queryByText("View on map"), null);
});

// ─── Signed out (this screen is public, alongside Search) ────────────

test.serial("renders the tool for a logged-out visitor", async (t) => {
  await render({ session: null, profile: null });

  t.truthy(screen.getByRole("heading", { name: "Wet tile saw" }));
  t.truthy(screen.getByText("Jim B."));
});

test.serial("asks a logged-out visitor to sign in rather than hiding the tool", async (t) => {
  await render({ session: null, profile: null });

  t.truthy(screen.getByRole("button", { name: /sign in to request/i }));
});

test.serial("runs no per-user queries at all when signed out", async (t) => {
  const { mock } = await render({ session: null, profile: null });

  t.false(mock.tablesTouched().includes("borrow_requests"));
  t.false(mock.tablesTouched().includes("favorites"));
});

test.serial("sends a logged-out visitor to sign in, remembering the tool", async (t) => {
  await render({ session: null, profile: null });

  fireEvent.click(screen.getByRole("button", { name: /sign in to request/i }));
  await flush();

  t.truthy(screen.getByTestId("login"));
});

test.serial("still keeps the pickup location locked when signed out", async (t) => {
  const { mock } = await render({ session: null, profile: null });

  t.truthy(screen.getByText(/sign in, get approved, then ask to collect/i));
  t.false(mock.rpcCalls.some((call) => call.name === "get_pickup_location"));
});

// ─── Signed in but not onboarded ─────────────────────────────────────

test.serial("routes an un-onboarded user to finish setup before requesting", async (t) => {
  // ToS acceptance is recorded during onboarding, and this screen sits outside
  // RequireAuth's onboarding redirect — so the gate has to live here too.
  const { mock } = await render({ profile: makeProfile({ profile_complete: false }) });

  fireEvent.click(screen.getByRole("button", { name: /finish setup to request/i }));
  await flush();

  t.truthy(screen.getByTestId("onboarding"));
  t.false(mock.rpcCalls.some((call) => call.name === "request_borrow"));
});

// ─── Loan durations (0024) ───────────────────────────────────────────

test.serial("pre-fills the borrow length with the owner's usual period", async (t) => {
  await render({ tool: { ...TOOL, default_loan_days: 5 } });
  await flush();

  t.is(screen.getByLabelText(/how long do you need it/i).value, "5");
});

test.serial("sends the borrower's chosen length with the request", async (t) => {
  const { mock } = await render({ tool: { ...TOOL, default_loan_days: 5 } });
  await flush();

  fireEvent.change(screen.getByLabelText(/how long do you need it/i), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: /request borrow/i }));
  await flush();

  t.is(mock.rpcCalls.find((c) => c.name === "request_borrow").args.p_days, 12);
});

test.serial("tells a visitor when a borrowed tool is due back", async (t) => {
  await render({ tool: { ...TOOL, status: "borrowed", due_at: "2099-09-04T18:00:00Z" } });
  await flush();

  t.truthy(screen.getByText(/Currently unavailable/i));
  // Once only — it used to be printed twice on the same screen.
  t.is(screen.getAllByText(/On lend until/i).length, 1);
});

test.serial("offers the owner's other tools when they publish a chest", async (t) => {
  await render({
    tool: { ...TOOL, profiles: { ...TOOL.profiles, chest_public: true } },
    chestCount: 4,
  });

  t.truthy(screen.getByRole("link", { name: /4 more/i }));
});

test.serial("offers nothing when the owner keeps their tools separate", async (t) => {
  await render({
    tool: { ...TOOL, profiles: { ...TOOL.profiles, chest_public: false } },
    chestCount: 4,
  });

  t.is(screen.queryByRole("link", { name: /more/i }), null);
});

test.serial("does not offer a chest link when this is the owner's only tool", async (t) => {
  // The count excludes this tool, so a lone listing links to a page showing
  // nothing new.
  await render({
    tool: { ...TOOL, profiles: { ...TOOL.profiles, chest_public: true } },
    chestCount: 0,
  });

  t.is(screen.queryByRole("link", { name: /more/i }), null);
});

test.serial("lets you borrow the same tool again after returning it", async (t) => {
  // The screen reads only your most recent request, and used to offer the
  // button solely when there was none or the last was denied. Completing a
  // loan therefore removed it for good — on a lending app, where borrowing the
  // same ladder next spring is the point.
  await render({ request: { id: "r1", status: "completed" } });

  t.truthy(screen.getByRole("button", { name: /request borrow/i }));
});

test.serial("lets you ask again after withdrawing a request", async (t) => {
  await render({ request: { id: "r1", status: "cancelled" } });

  t.truthy(screen.getByRole("button", { name: /request borrow/i }));
});

test.serial("still hides the button while a request is live", async (t) => {
  await render({ request: { id: "r1", status: "pending" } });

  t.is(screen.queryByRole("button", { name: /request borrow/i }), null);
});

test.serial("does not offer push on a screen nobody has acted on", async (t) => {
  // The offer belongs after a request, not on arrival. Raising the browser's
  // one-shot prompt on page load is what gets a site's notifications denied
  // permanently.
  await render();

  t.is(screen.queryByText(/want push notifications/i), null);
});

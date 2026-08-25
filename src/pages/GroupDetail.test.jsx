import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  flush,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import GroupDetail from "./GroupDetail.jsx";

test.afterEach(() => {
  cleanup();
});

const GROUP = {
  id: "grp-1",
  name: "Oak Hill Neighbors",
  neighborhood_label: "Oak Hill",
  city: "Santa Rosa",
  zip_code: "95403",
  invite_code: "XHGVFT2",
  admin_id: "someone-else",
  default_exchange_location: "Oak Hill Park, main entrance",
  approx_lat: 38.48,
  approx_lng: -122.75,
};

const MEMBERSHIPS = [
  { id: "mem-1", profile_id: "someone-else", status: "approved" },
  { id: "mem-2", profile_id: "other-1", status: "approved" },
  { id: "mem-3", profile_id: "other-2", status: "pending" },
];

const PENDING = [
  { id: "mem-3", requested_at: "2026-08-01T00:00:00Z", profiles: { display_name: "Ana R." } },
];

const TOOLS = [
  {
    id: "tool-1",
    name: "Circular saw",
    category: "Cutting",
    status: "available",
    monetize: false,
    price: null,
    price_duration_unit: null,
    crib_id: "other-1",
    profiles: { display_name: "Jim B." },
  },
];

function app() {
  return (
    <Routes>
      <Route path="/groups/:id" element={<GroupDetail />} />
    </Routes>
  );
}

/**
 * GroupDetail reads `group_memberships` twice — all rows, then (admins only)
 * the pending ones — so the stub answers them in order.
 */
// invite_code / default_exchange_location come back through
// get_group_invite_details() now, not a plain column select (SEC-2) — this
// stands in for the RPC unless a test overrides `rpc` itself.
function defaultRpc(group) {
  return (name) =>
    name === "get_group_invite_details"
      ? { data: [{ invite_code: group.invite_code, default_exchange_location: group.default_exchange_location }], error: null }
      : { data: null, error: null };
}

function render({ group = GROUP, memberships = MEMBERSHIPS, pending = PENDING, tools = TOOLS, rpc } = {}) {
  let membershipReads = 0;
  return renderPage(app(), {
    route: "/groups/grp-1",
    supabase: {
      from: (table) => {
        if (table === "groups") return new MockQueryBuilder({ data: group, error: null });
        if (table === "group_memberships") {
          return new MockQueryBuilder({ data: membershipReads++ === 0 ? memberships : pending, error: null });
        }
        if (table === "tools") return new MockQueryBuilder({ data: tools, error: null });
        return new MockQueryBuilder({ data: null, error: null });
      },
      rpc: rpc ?? defaultRpc(group),
    },
  });
}

const asAdmin = (extra = {}) => render({ group: { ...GROUP, admin_id: TEST_USER_ID }, ...extra });

// ─── Everyone ────────────────────────────────────────────────────────

test.serial("renders the group's name and location details", async (t) => {
  await render();

  t.truthy(screen.getByText("Oak Hill · Santa Rosa · 95403"));
});

test.serial("counts only approved members", async (t) => {
  await render();

  t.truthy(screen.getByText(/^2 members/));
});

test.serial("lists tools owned by approved members only", async (t) => {
  const { mock } = await render();

  t.truthy(screen.getByText("Circular saw"));
  t.deepEqual(mock.builderFor("tools").argsFor("in"), ["crib_id", ["someone-else", "other-1"]]);
});

test.serial("never selects pickup_location when listing a group's tools", async (t) => {
  const { mock } = await render();

  t.false(mock.builderFor("tools").argsFor("select")[0].includes("pickup_location"));
});

test.serial("skips the tools query entirely when nobody is approved yet", async (t) => {
  const { mock } = await render({ memberships: [], tools: [] });

  t.false(mock.tablesTouched().includes("tools"));
  t.truthy(screen.getByText(/No tools listed by this group's members yet/i));
});

test.serial("hides the invite code from non-members", async (t) => {
  await render({ memberships: [] });

  t.is(screen.queryByText("XHGVFT2"), null);
});

test.serial("shows the invite code to an approved member", async (t) => {
  await render({
    memberships: [...MEMBERSHIPS, { id: "mem-me", profile_id: TEST_USER_ID, status: "approved" }],
  });

  t.truthy(screen.getByText("XHGVFT2"));
});

// ─── Joining ─────────────────────────────────────────────────────────

test.serial("offers to join when you have no membership row", async (t) => {
  await render({ memberships: [] });

  t.truthy(screen.getByRole("button", { name: /Request to Join/i }));
});

test.serial("joins through the request_to_join_group RPC and logs the event", async (t) => {
  const { mock } = await render({ memberships: [] });

  fireEvent.click(screen.getByRole("button", { name: /Request to Join/i }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "request_to_join_group").args, { p_group_id: "grp-1" });
  t.truthy(mock.eventLogged("group_joined"));
});

test.serial("shows a pending state instead of a second join button", async (t) => {
  await render({
    memberships: [{ id: "mem-me", profile_id: TEST_USER_ID, status: "pending" }],
  });

  t.truthy(screen.getByText("Request Pending"));
  t.is(screen.queryByRole("button", { name: /Request to Join/i }), null);
});

test.serial("surfaces a join failure", async (t) => {
  await render({ memberships: [], rpc: () => ({ data: null, error: { message: "Group not found" } }) });

  fireEvent.click(screen.getByRole("button", { name: /Request to Join/i }));
  await flush();

  t.truthy(screen.getByText("Group not found"));
});

// ─── Admin ───────────────────────────────────────────────────────────

test.serial("shows the admin inbox only to the admin", async (t) => {
  await render();
  t.is(screen.queryByText("Admin inbox"), null);

  cleanup();

  await asAdmin();
  t.truthy(screen.getByText("Admin inbox"));
  t.truthy(screen.getByText("Ana R."));
});

test.serial("approves a membership through the RPC", async (t) => {
  const { mock } = await asAdmin();

  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "decide_group_membership").args, {
    p_membership_id: "mem-3",
    p_approve: true,
  });
});

test.serial("denies a membership through the same RPC", async (t) => {
  const { mock } = await asAdmin();

  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await flush();

  t.deepEqual(mock.rpcCalls.find((c) => c.name === "decide_group_membership").args, {
    p_membership_id: "mem-3",
    p_approve: false,
  });
});

test.serial("lets only the admin edit the default exchange spot", async (t) => {
  await render();
  t.is(screen.queryByRole("button", { name: "Edit" }), null);

  cleanup();

  await asAdmin();
  t.truthy(screen.getByRole("button", { name: "Edit" }));
});

test.serial("saves an edited exchange spot, trimmed", async (t) => {
  const { mock } = await asAdmin();

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const input = screen.getByDisplayValue("Oak Hill Park, main entrance");
  fireEvent.change(input, { target: { value: "  Library car park  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();

  const updater = mock.fromCalls.filter((c) => c.table === "groups").at(-1).builder;
  t.deepEqual(updater.argsFor("update")[0], { default_exchange_location: "Library car park" });
  t.truthy(screen.getByText("Library car park"));
});

test.serial("clears the exchange spot to null rather than an empty string", async (t) => {
  const { mock } = await asAdmin();

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByDisplayValue("Oak Hill Park, main entrance"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();

  const updater = mock.fromCalls.filter((c) => c.table === "groups").at(-1).builder;
  t.deepEqual(updater.argsFor("update")[0], { default_exchange_location: null });
});

test.serial("surfaces a load failure instead of rendering a blank screen", async (t) => {
  await renderPage(app(), {
    route: "/groups/grp-1",
    supabase: {
      from: () => new MockQueryBuilder({ data: null, error: { message: "permission denied" } }),
    },
  });

  t.truthy(screen.getByText("permission denied"));
});

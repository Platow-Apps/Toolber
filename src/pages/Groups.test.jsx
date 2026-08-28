import test from "ava";
import {
  cleanup,
  fireEvent,
  flush,
  makeProfile,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import Groups from "./Groups.jsx";

test.afterEach(() => {
  cleanup();
});

const MEMBERSHIPS = [
  {
    id: "mem-1",
    status: "approved",
    group: { id: "grp-1", name: "Oak Hill Neighbors", neighborhood_label: "Oak Hill", city: "Santa Rosa" },
  },
  {
    id: "mem-2",
    status: "pending",
    group: { id: "grp-2", name: "Coffey Park Tools", neighborhood_label: "Coffey Park", city: "Santa Rosa" },
  },
];

const GROUPS = [
  {
    id: "grp-near",
    name: "Coffey Park Tools",
    neighborhood_label: "Coffey Park",
    city: "Santa Rosa",
    zip_code: "95403",
    invite_code: "XHGVFT2",
    admin_id: "someone-else",
    approx_lat: 38.4845,
    approx_lng: -122.7507,
    group_memberships: [
      { profile_id: "other-1", status: "approved" },
      { profile_id: "other-2", status: "pending" },
    ],
  },
  {
    id: "grp-far",
    name: "Bernal Heights Borrowers",
    neighborhood_label: "Bernal",
    city: "San Francisco",
    zip_code: "94110",
    invite_code: "QWERTY9",
    admin_id: TEST_USER_ID,
    approx_lat: 37.7749,
    approx_lng: -122.4194,
    group_memberships: [{ profile_id: TEST_USER_ID, status: "approved" }],
  },
];

function render({ memberships = MEMBERSHIPS, groups = GROUPS, profile = makeProfile(), rpc } = {}) {
  return renderPage(<Groups />, {
    route: "/groups",
    profile,
    supabase: {
      from: (table) => {
        if (table === "group_memberships") return new MockQueryBuilder({ data: memberships, error: null });
        if (table === "groups") return new MockQueryBuilder({ data: groups, error: null });
        return new MockQueryBuilder({ data: null, error: null });
      },
      // Default: both join paths report that a request was actually created.
      // They return a status string now, not a membership id (audit LOGIC-5).
      rpc: rpc ?? (() => ({ data: "requested", error: null })),
    },
  });
}

const findTab = () => screen.getByRole("button", { name: "Find a Group" });

// ─── My Groups ───────────────────────────────────────────────────────

test.serial("opens on My Groups", async (t) => {
  await render();

  t.truthy(screen.getByText("Oak Hill Neighbors"));
});

test.serial("marks a membership that is still awaiting approval", async (t) => {
  await render();

  t.truthy(screen.getByText("Request Pending"));
});

test.serial("links each group through to its detail screen", async (t) => {
  await render();

  t.is(screen.getByText("Oak Hill Neighbors").closest("a").getAttribute("href"), "/groups/grp-1");
});

test.serial("shows an empty state pointing at Find a Group", async (t) => {
  await render({ memberships: [] });

  t.truthy(screen.getByText(/haven't joined any groups yet/i));
});

// ─── Find a Group ────────────────────────────────────────────────────

test.serial("counts only approved members", async (t) => {
  await render();
  fireEvent.click(findTab());
  await flush();

  // grp-near has one approved and one pending member — the pending one must
  // not be counted.
  t.truthy(screen.getByText(/Coffey Park · Santa Rosa · 1 member$/));
});

test.serial("sorts nearer groups first using the chest's own approximate point", async (t) => {
  await render({ profile: makeProfile({ approx_lat: 38.4845, approx_lng: -122.7507 }) });
  fireEvent.click(findTab());
  await flush();

  const names = screen.getAllByText(/Coffey Park Tools|Bernal Heights Borrowers/).map((n) => n.textContent);
  t.is(names[0], "Coffey Park Tools");
});

test.serial("shows a distance for groups it can place", async (t) => {
  await render({ profile: makeProfile({ approx_lat: 38.4845, approx_lng: -122.7507 }) });
  fireEvent.click(findTab());
  await flush();

  t.truthy(screen.getByText("Nearby"));
});

test.serial("filters by name, city or zip", async (t) => {
  await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.change(screen.getByPlaceholderText(/name, neighborhood, city, zip/i), {
    target: { value: "94110" },
  });

  t.truthy(screen.getByText("Bernal Heights Borrowers"));
  t.is(screen.queryByText("Coffey Park Tools"), null);
});

test.serial("badges a group you administer instead of offering to join it", async (t) => {
  await render();
  fireEvent.click(findTab());
  await flush();

  t.truthy(screen.getByText("Admin"));
});

test.serial("requests to join through the request_to_join_group RPC", async (t) => {
  const { mock } = await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /Request to Join/i }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "request_to_join_group").args,
    { p_group_id: "grp-near" }
  );
});

test.serial("logs a group_joined event on request", async (t) => {
  const { mock } = await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /Request to Join/i }));
  await flush();

  t.truthy(mock.eventLogged("group_joined"));
});

test.serial("upper-cases a hand-typed invite code before sending it", async (t) => {
  const { mock } = await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.change(screen.getByPlaceholderText(/Have an invite code/i), {
    target: { value: "  xhgvft2 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((call) => call.name === "join_group").args,
    { p_invite_code: "XHGVFT2" }
  );
});

test.serial("confirms a successful code join", async (t) => {
  await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.change(screen.getByPlaceholderText(/Have an invite code/i), { target: { value: "XHGVFT2" } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await flush();

  t.truthy(screen.getByText("Request sent."));
});

test.serial("surfaces an invalid invite code", async (t) => {
  await render({ rpc: () => ({ data: null, error: { message: "Invalid invite code" } }) });
  fireEvent.click(findTab());
  await flush();

  fireEvent.change(screen.getByPlaceholderText(/Have an invite code/i), { target: { value: "NOPE123" } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await flush();

  t.truthy(screen.getByText("Invalid invite code"));
});

test.serial("ignores an empty invite code submission", async (t) => {
  const { mock } = await render();
  fireEvent.click(findTab());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await flush();

  t.false(mock.rpcCalls.some((call) => call.name === "join_group"));
});

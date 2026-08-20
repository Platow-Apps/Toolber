import test from "ava";
import { Route, Routes } from "react-router-dom";
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
import CreateGroup from "./CreateGroup.jsx";

test.afterEach(() => {
  cleanup();
});

function app() {
  return (
    <Routes>
      <Route path="/groups/new" element={<CreateGroup />} />
      <Route path="/groups/:id" element={<div data-testid="group-detail">group detail</div>} />
    </Routes>
  );
}

/**
 * @param {object} options
 * @param {Array<{data: unknown, error: unknown}>} [options.groupInserts]
 *   One result per attempt, so the unique-invite-code retry loop can be driven.
 */
function render({
  groupInserts = [{ data: { id: "grp-new" }, error: null }],
  membershipResult = { data: null, error: null },
  profile = makeProfile(),
} = {}) {
  let attempt = 0;
  return renderPage(app(), {
    route: "/groups/new",
    profile,
    supabase: {
      from: (table) => {
        if (table === "groups") {
          return new MockQueryBuilder(groupInserts[Math.min(attempt++, groupInserts.length - 1)]);
        }
        if (table === "group_memberships") return new MockQueryBuilder(membershipResult);
        return new MockQueryBuilder({ data: null, error: null });
      },
    },
  });
}

const nameField = () => screen.getByPlaceholderText(/Oak Hill Neighbors/i);
const submitButton = () => screen.getByRole("button", { name: /create group/i });

function fill({ name = "Oak Hill Neighbors", city = "Santa Rosa", zip = "95403" } = {}) {
  fireEvent.change(nameField(), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Oak Hill$/i), { target: { value: "Oak Hill" } });
  const [cityInput, zipInput] = screen
    .getAllByText(/^(City|Zip)/)
    .map((label) => label.parentElement.querySelector("input"));
  fireEvent.change(cityInput, { target: { value: city } });
  fireEvent.change(zipInput, { target: { value: zip } });
}

test.serial("requires a group name before submitting", async (t) => {
  await render();

  t.true(submitButton().disabled);

  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });
  t.false(submitButton().disabled);
});

test.serial("makes the creator the admin and generates an invite code", async (t) => {
  const { mock } = await render();
  fill();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("groups").argsFor("insert")[0];
  t.is(row.admin_id, TEST_USER_ID);
  t.regex(row.invite_code, /^[A-Z0-9]{7}$/);
  t.is(row.name, "Oak Hill Neighbors");
  t.is(row.city, "Santa Rosa");
  t.is(row.zip_code, "95403");
});

test.serial("stores blank optional fields as null", async (t) => {
  const { mock } = await render();
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("groups").argsFor("insert")[0];
  t.is(row.neighborhood_label, null);
  t.is(row.city, null);
  t.is(row.zip_code, null);
  t.is(row.default_exchange_location, null);
});

test.serial("seeds the group pin from the creator's own approximate point", async (t) => {
  // Documents today's placeholder behaviour (see the in-form notice). It also
  // means the group pin lands exactly on the admin's crib pin — see the audit
  // note on group pin placement.
  const { mock } = await render({ profile: makeProfile({ approx_lat: 38.4, approx_lng: -122.7 }) });
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("groups").argsFor("insert")[0];
  t.is(row.approx_lat, 38.4);
  t.is(row.approx_lng, -122.7);
});

test.serial("adds the creator as an approved member of their own group", async (t) => {
  const { mock } = await render();
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("group_memberships").argsFor("insert")[0];
  t.is(row.group_id, "grp-new");
  t.is(row.profile_id, TEST_USER_ID);
  t.is(row.status, "approved");
  t.truthy(row.decided_at);
});

test.serial("logs a group_created event", async (t) => {
  const { mock } = await render();
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  t.deepEqual(mock.eventLogged("group_created"), {
    profile_id: TEST_USER_ID,
    event_type: "group_created",
    metadata: { group_id: "grp-new" },
  });
});

test.serial("lands on the new group's detail screen", async (t) => {
  await render();
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByTestId("group-detail"));
});

test.serial("retries with a fresh code when the invite code collides", async (t) => {
  const { mock } = await render({
    groupInserts: [
      { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      { data: { id: "grp-new" }, error: null },
    ],
  });
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  const attempts = mock.fromCalls.filter((call) => call.table === "groups");
  t.is(attempts.length, 2);
  t.not(attempts[0].builder.argsFor("insert")[0].invite_code, attempts[1].builder.argsFor("insert")[0].invite_code);
  t.truthy(screen.getByTestId("group-detail"));
});

test.serial("gives up on a non-collision error without retrying", async (t) => {
  const { mock } = await render({
    groupInserts: [{ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }],
  });
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.fromCalls.filter((call) => call.table === "groups").length, 1);
  t.truthy(screen.getByText("new row violates row-level security policy"));
});

test.serial("reports a group created without its creator membership", async (t) => {
  // There is no transaction around the two inserts, so this half-created state
  // is reachable — the UI at least has to say so rather than navigate away.
  await render({ membershipResult: { data: null, error: { message: "row-level security" } } });
  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText(/Group created, but couldn't add you as a member/i));
  t.is(screen.queryByTestId("group-detail"), null);
});

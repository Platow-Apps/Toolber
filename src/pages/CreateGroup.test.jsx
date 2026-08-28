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
 * Creating a group is one `create_group()` RPC now, not a group insert
 * followed by a membership insert (audit LOGIC-6) — so these drive the RPC
 * result rather than a sequence of table writes.
 */
function render({ rpcResult = { data: "grp-new", error: null }, profile = makeProfile() } = {}) {
  return renderPage(app(), {
    route: "/groups/new",
    profile,
    supabase: {
      from: () => new MockQueryBuilder({ data: null, error: null }),
      rpc: () => rpcResult,
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

test.serial("keeps submit disabled until the group has a name", async (t) => {
  await render();
  t.true(submitButton().disabled);

  fireEvent.change(nameField(), { target: { value: "Oak Hill Neighbors" } });
  t.false(submitButton().disabled);
});

test.serial("creates the group in a single RPC, not two client writes", async (t) => {
  // The group row and the creator's membership have to land together. As two
  // separate inserts, a failure on the second left a group with no members and
  // its creator locked out, with the invite code burnt (audit LOGIC-6).
  const { mock } = await render();
  fill();

  fireEvent.click(submitButton());
  await flush();

  const call = mock.rpcCalls.find((c) => c.name === "create_group");
  t.truthy(call);
  t.is(call.args.p_name, "Oak Hill Neighbors");
  t.is(call.args.p_city, "Santa Rosa");
  t.is(call.args.p_zip_code, "95403");
  // No direct writes to either table any more.
  t.false(mock.tablesTouched().includes("groups"));
  t.false(mock.tablesTouched().includes("group_memberships"));
});

test.serial("never sends the creator's own coordinates", async (t) => {
  // Copying the creator's chest point onto the group put the group pin exactly
  // on that chest's pin, identifying whose chest belongs to the admin (audit
  // LOGIC-8). The pin is a members' centroid computed server-side now.
  const { mock } = await render({
    profile: makeProfile({ approx_lat: 38.44, approx_lng: -122.71 }),
  });
  fill();

  fireEvent.click(submitButton());
  await flush();

  const args = mock.rpcCalls.find((c) => c.name === "create_group").args;
  t.false(JSON.stringify(args).includes("38.44"));
  t.false(JSON.stringify(args).includes("approx"));
});

test.serial("never generates an invite code in the browser", async (t) => {
  // Generated inside create_group() now, so its uniqueness retry happens in
  // the same transaction that uses it (audit LOGIC-7).
  const { mock } = await render();
  fill();

  fireEvent.click(submitButton());
  await flush();

  const args = mock.rpcCalls.find((c) => c.name === "create_group").args;
  t.false(Object.keys(args).some((k) => k.includes("invite")));
});

test.serial("stores blank optional fields as null", async (t) => {
  const { mock } = await render();
  fireEvent.change(nameField(), { target: { value: "Just A Name" } });

  fireEvent.click(submitButton());
  await flush();

  const args = mock.rpcCalls.find((c) => c.name === "create_group").args;
  t.is(args.p_city, null);
  t.is(args.p_zip_code, null);
  t.is(args.p_neighborhood_label, null);
});

test.serial("logs a group_created event", async (t) => {
  const { mock } = await render();
  fill();

  fireEvent.click(submitButton());
  await flush();

  t.deepEqual(mock.eventLogged("group_created")?.metadata, { group_id: "grp-new" });
});

test.serial("lands on the new group's detail screen", async (t) => {
  await render();
  fill();

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByTestId("group-detail"));
});

test.serial("stays on the form and surfaces the error when creation fails", async (t) => {
  await render({ rpcResult: { data: null, error: { message: "Could not allocate an invite code, please try again" } } });
  fill();

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText(/Could not allocate an invite code/i));
  t.is(screen.queryByTestId("group-detail"), null);
});

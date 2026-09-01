import test from "ava";
import {
  cleanup,
  fireEvent,
  flush,
  makeProfile,
  renderWithAuth,
  screen,
} from "../../test/setup.jsx";
import Settings from "./Settings.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("shows the display name and account email", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: "Jim B." }) });

  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("tester@toolber.test"));
});

test.serial("falls back to Unnamed before onboarding sets a display name", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: null }) });

  t.truthy(screen.getByText("Unnamed"));
});

test.serial("derives the avatar initial from the display name", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: "jim b." }) });

  t.truthy(screen.getByText("J"));
});

test.serial("falls back to the email initial when there is no display name", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: null }) });

  t.truthy(screen.getByText("T")); // tester@toolber.test
});

test.serial("signs out on demand", async (t) => {
  const { mock } = await renderWithAuth(<Settings />);

  fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
  await flush();

  t.deepEqual(mock.authCalls, [{ method: "signOut" }]);
});

// ── Account deletion (0032) ─────────────────────────────────────────────

const deleteButton = () => screen.getByRole("button", { name: "Delete my account" });

test.serial("asks for confirmation before deleting anything", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, { profile: makeProfile() });

  fireEvent.click(deleteButton());
  await flush();

  // First click only reveals the confirm step — nothing has been sent.
  t.is(mock.rpcCalls.filter((c) => c.name === "delete_my_account").length, 0);
  t.truthy(screen.getByRole("button", { name: /yes, delete it/i }));
});

test.serial("says plainly what survives deletion", async (t) => {
  // "Everything disappears" would be a lie: the counterparty's borrow history
  // and messages stay, anonymised.
  await renderWithAuth(<Settings />, { profile: makeProfile() });

  fireEvent.click(deleteButton());
  t.truthy(screen.getByText(/stay visible to the neighbor on the other side/i));
});

test.serial("backing out leaves the account alone", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, { profile: makeProfile() });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /keep my account/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "delete_my_account").length, 0);
  t.truthy(deleteButton());
});

test.serial("confirming calls the guarded RPC", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: { rpc: (name) => (name === "delete_my_account" ? { data: [], error: null } : { data: null, error: null }) },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.truthy(mock.rpcCalls.find((c) => c.name === "delete_my_account"));
});

test.serial("surfaces the open-loan guard instead of appearing to delete", async (t) => {
  // The server refuses while a borrow is outstanding — leaving mid-loan
  // strands the other party.
  await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      rpc: (name) =>
        name === "delete_my_account"
          ? { data: null, error: { message: "You have 1 open borrow request(s). Finish or cancel them before deleting your account." } }
          : { data: null, error: null },
    },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.truthy(screen.getByText(/1 open borrow request/i));
});

test.serial("frees the email address so the person can sign up again later", async (t) => {
  // Without this the address stays reserved forever and a neighbor who
  // leaves can never come back (checklist F2b).
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: { rpc: (name) => (name === "delete_my_account" ? { data: [], error: null } : { data: null, error: null }) },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.truthy(mock.functionCalls.find((c) => c.name === "release-account-email"));
});

test.serial("still signs out if the address can't be freed", async (t) => {
  // The account is already deleted by then. Failing here must not strand
  // someone on a settings page for an account that no longer exists.
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      rpc: (name) => (name === "delete_my_account" ? { data: [], error: null } : { data: null, error: null }),
      functions: () => ({ data: null, error: { message: "could not release address" } }),
    },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.true(mock.authCalls.some((c) => c.method === "signOut"));
});

test.serial("releases the address only after deletion actually succeeded", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      rpc: (name) =>
        name === "delete_my_account"
          ? { data: null, error: { message: "You have 1 open borrow request(s)." } }
          : { data: null, error: null },
    },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.is(mock.functionCalls.length, 0);
  t.false(mock.authCalls.some((c) => c.method === "signOut"));
});

test.serial("deleting an account takes its devices off the push list", async (t) => {
  // profiles rows are scrubbed rather than deleted (0032), so the ON DELETE
  // CASCADE on push_subscriptions never fires. Without this call, a deleted
  // account's phone keeps buzzing.
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: { rpc: (name) => (name === "delete_my_account" ? { data: [], error: null } : { data: null, error: null }) },
  });

  fireEvent.click(deleteButton());
  fireEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
  await flush();

  t.truthy(mock.rpcCalls.find((c) => c.name === "delete_my_push_subscriptions"));
});

test.serial("hides the push toggle where the browser cannot do push", async (t) => {
  // jsdom has no PushManager, which is the same state as a browser that does
  // not support it. Offering a switch that cannot work is worse than nothing.
  await renderWithAuth(<Settings />, { profile: makeProfile() });

  t.is(screen.queryByText(/notifications on this device/i), null);
});

test.serial("offers a switch for showing tools as a collection", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, { profile: makeProfile() });

  const toggle = screen.getByLabelText(/show my tools as a collection/i);
  fireEvent.click(toggle);
  await flush();

  const write = mock.findBuilder("profiles", "update");
  // makeProfile() carries no chest_public, so the switch loads unchecked and
  // the click turns it on. What matters is that the click writes the column.
  t.deepEqual(write.argsFor("update")[0], { chest_public: true });
});

test.serial("does not claim switching the chest off hides anything", async (t) => {
  // It is a display preference, not access control — every tool stays
  // individually searchable. Implying otherwise would be a promise the schema
  // does not keep.
  await renderWithAuth(<Settings />, { profile: makeProfile() });

  t.true(screen.getAllByText(/still findable on its own/i).length > 0);
  t.true(screen.getAllByText(/pause it from My Tools/i).length > 0);
});

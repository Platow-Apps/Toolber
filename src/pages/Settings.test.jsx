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

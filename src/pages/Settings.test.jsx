import test from "ava";
import {
  cleanup,
  fireEvent,
  flush,
  makeProfile,
  MockQueryBuilder,
  renderWithAuth,
  screen,
} from "../../test/setup.jsx";
import Settings from "./Settings.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("shows the display name and account email", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: "Jim B." }) });

  t.true(screen.getAllByText("Jim B.").length > 0);
  t.truthy(screen.getByText("tester@toolber.test"));
});

test.serial("falls back to Unnamed before onboarding sets a display name", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: null }) });

  t.truthy(screen.getByText("Unnamed"));
});

test.serial("derives the avatar initial from the display name", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: "jim b." }) });

  t.true(screen.getAllByText("J").length > 0);
});

test.serial("offers a way to change the display name", async (t) => {
  // It was set once at onboarding and never editable again — but a display
  // name is the only thing other neighbors see, and people change their minds.
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile({ display_name: "Jim B." }),
  });

  const field = screen.getByLabelText("Display name");
  fireEvent.change(field, { target: { value: "Mr. Miyagi" } });
  fireEvent.click(screen.getByRole("button", { name: "Save display name" }));
  await flush();

  const write = mock.findBuilder("profiles", "update");
  t.deepEqual(write.argsFor("update")[0], { display_name: "Mr. Miyagi" });
});

test.serial("will not save an empty display name", async (t) => {
  // Blank would leave the person as "Unnamed" everywhere, which nobody means
  // to do and nothing else in the app would explain.
  await renderWithAuth(<Settings />, { profile: makeProfile({ display_name: "Jim B." }) });

  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
  t.true(screen.getByRole("button", { name: "Save display name" }).disabled);
});

test.serial("offers to add a photo when there is none", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ avatar_url: null }) });

  t.true(screen.getAllByText(/add photo/i).length > 0);
  t.is(screen.queryByRole("button", { name: /remove/i }), null);
});

test.serial("offers to change or remove an existing photo", async (t) => {
  await renderWithAuth(<Settings />, { profile: makeProfile({ avatar_url: "u1/pic.jpg" }) });

  t.true(screen.getAllByText(/change photo/i).length > 0);
  t.truthy(screen.getByRole("button", { name: /remove/i }));
});

test.serial("removing a photo clears the column rather than deleting the row", async (t) => {
  const { mock } = await renderWithAuth(<Settings />, {
    profile: makeProfile({ avatar_url: "u1/pic.jpg" }),
  });

  fireEvent.click(screen.getByRole("button", { name: /remove/i }));
  await flush();

  const write = mock.findBuilder("profiles", "update");
  t.deepEqual(write.argsFor("update")[0], { avatar_url: null });
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

  t.is(screen.queryByLabelText("Push notifications", { selector: "input" }), null);
});

test.serial("offers exactly one push control, never two", async (t) => {
  // There were two: an account-level flag and a per-device registration. Only
  // the device one appeared to do anything, because the flag is read
  // server-side -- so one of the two checkboxes looked broken.
  await renderWithAuth(<Settings />, { profile: makeProfile() });

  t.true(screen.queryAllByLabelText(/push/i, { selector: "input" }).length <= 1);
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

test.serial("says why a sharing switch would not move", async (t) => {
  // These columns are column-grant restricted (0009, 0039). A refused write
  // used to revert the checkbox with nothing on screen to explain it, which
  // reads as a stuck control rather than a permission error.
  await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      from: (table) =>
        table === "profiles"
          ? new MockQueryBuilder({ data: null, error: { message: "permission denied for column share_email_on_approval" } })
          : new MockQueryBuilder({ data: null, error: null }),
    },
  });

  fireEvent.click(screen.getByLabelText(/share my email address/i));
  await flush();

  t.truthy(screen.getByText(/permission denied for column share_email_on_approval/i));
});

test.serial("lets email be turned off on its own", async (t) => {
  // Getting an email *and* a buzz for every borrow request is a lot of noise
  // for one piece of news, and which one people want to keep differs.
  const { mock } = await renderWithAuth(<Settings />, { profile: makeProfile() });

  fireEvent.click(screen.getByLabelText("Email", { selector: "input" }));
  await flush();

  const write = mock.findBuilder("notification_preferences", "update");
  t.deepEqual(write.argsFor("update")[0], { email_enabled: false });
});

test.serial("a refused channel write says so instead of quietly reverting", async (t) => {
  // The switch is optimistic, so a rejected write moves it and moves it back
  // — indistinguishable from a stuck control unless the reason is shown.
  // The read has to succeed for the switch to exist at all, so only the second
  // call to the table fails.
  let calls = 0;
  await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      from: (table) => {
        if (table !== "notification_preferences") {
          return new MockQueryBuilder({ data: null, error: null });
        }
        calls += 1;
        return calls === 1
          ? new MockQueryBuilder({ data: { email_enabled: true, push_enabled: true }, error: null })
          : new MockQueryBuilder({ data: null, error: { message: "permission denied" } });
      },
    },
  });

  fireEvent.click(screen.getByLabelText("Email", { selector: "input" }));
  await flush();

  t.truthy(screen.getByText("permission denied"));
});

test.serial("leaves Save inert until the phone number actually changes", async (t) => {
  // It matched the display-name field everywhere except here, where the
  // button stayed lit from the moment the page loaded and offered to save a
  // value identical to the stored one.
  await renderWithAuth(<Settings />, { profile: makeProfile() });

  const save = screen.getByRole("button", { name: "Save phone number" });
  t.true(save.disabled);

  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "555-0101" } });
  t.false(save.disabled);
});

test.serial("says why a phone number would not save", async (t) => {
  // phone is column-grant restricted like pickup_location, so a refused write
  // is a real possibility -- and this used to be swallowed entirely.
  await renderWithAuth(<Settings />, {
    profile: makeProfile(),
    supabase: {
      from: (table) =>
        table === "profiles"
          ? new MockQueryBuilder({ data: null, error: { message: "permission denied for column phone" } })
          : new MockQueryBuilder({ data: null, error: null }),
    },
  });

  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "555-0101" } });
  fireEvent.click(screen.getByRole("button", { name: "Save phone number" }));
  await flush();

  t.truthy(screen.getByText(/permission denied for column phone/i));
});

import test from "ava";
import {
  act,
  cleanup,
  fireEvent,
  flush,
  makeProfile,
  makeSession,
  MockQueryBuilder,
  renderWithAuth,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import { useAuth } from "./AuthContext.jsx";

test.afterEach(() => {
  cleanup();
});

/** Renders the whole context as text so assertions can read it back. */
function Probe() {
  const { session, user, profile, loading, signOut, refreshProfile } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? "none"}</span>
      <span data-testid="session">{session ? "yes" : "no"}</span>
      <span data-testid="profile">{profile?.display_name ?? "none"}</span>
      <button type="button" onClick={signOut}>
        sign out
      </button>
      <button type="button" onClick={refreshProfile}>
        refresh
      </button>
    </div>
  );
}

const read = (id) => screen.getByTestId(id).textContent;

test.serial("exposes the session, user and profile once loaded", async (t) => {
  await renderWithAuth(<Probe />, { profile: makeProfile({ display_name: "Jim B." }) });

  t.is(read("loading"), "false");
  t.is(read("session"), "yes");
  t.is(read("user"), TEST_USER_ID);
  t.is(read("profile"), "Jim B.");
});

test.serial("settles to signed-out rather than loading forever", async (t) => {
  await renderWithAuth(<Probe />, { session: null, profile: null });

  t.is(read("loading"), "false");
  t.is(read("session"), "no");
  t.is(read("user"), "none");
  t.is(read("profile"), "none");
});

test.serial("only ever selects the client-readable profile columns", async (t) => {
  // home_lat/home_lng are revoked from the client role — asking for them makes
  // the whole select fail, taking the profile with it.
  const { mock } = await renderWithAuth(<Probe />);

  const columns = mock.builderFor("profiles").argsFor("select")[0];
  t.false(columns.includes("home_lat"));
  t.false(columns.includes("home_lng"));
  t.true(columns.includes("profile_complete"));
});

test.serial("leaves the profile null when the read fails", async (t) => {
  await renderWithAuth(<Probe />, {
    supabase: { tables: { profiles: { data: null, error: { message: "permission denied" } } } },
  });

  t.is(read("profile"), "none");
  t.is(read("session"), "yes");
});

test.serial("signs out through supabase-js", async (t) => {
  const { mock } = await renderWithAuth(<Probe />);

  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  await flush();

  t.deepEqual(mock.authCalls, [{ method: "signOut" }]);
});

test.serial("re-reads the profile on refreshProfile", async (t) => {
  let displayName = "Before";
  const { mock } = await renderWithAuth(<Probe />, {
    supabase: {
      from: () => new MockQueryBuilder({ data: { display_name: displayName }, error: null }),
    },
  });

  displayName = "After";
  fireEvent.click(screen.getByRole("button", { name: "refresh" }));
  await flush();

  t.is(read("profile"), "After");
  t.is(mock.fromCalls.filter((call) => call.table === "profiles").length, 2);
});

test.serial("picks up a session that arrives from an auth state change", async (t) => {
  const { mock } = await renderWithAuth(<Probe />, { session: null, profile: null });

  t.is(read("session"), "no");

  await act(async () => {
    mock.emitAuthChange("SIGNED_IN", makeSession());
  });
  await flush();

  t.is(read("session"), "yes");
  t.is(read("user"), TEST_USER_ID);
});

test.serial("clears the profile when the session goes away", async (t) => {
  const { mock } = await renderWithAuth(<Probe />, { profile: makeProfile({ display_name: "Jim B." }) });

  await act(async () => {
    mock.emitAuthChange("SIGNED_OUT", null);
  });
  await flush();

  t.is(read("session"), "no");
  t.is(read("profile"), "none");
});

// ── A deleted account must not be able to walk back in (0032) ───────────

test.serial("signs out a session whose profile has been deleted", async (t) => {
  // Deletion scrubs the profile and sets profile_complete = false. RequireAuth
  // reads an incomplete profile as "needs onboarding" and would hand them the
  // setup form — letting them fill their account back in. The session has to
  // end here instead, before any route sees it.
  const { mock } = await renderWithAuth(<Probe />, {
    profile: makeProfile({ deleted_at: "2026-08-29T12:00:00Z", profile_complete: false }),
  });
  await flush();

  t.is(screen.getByTestId("profile").textContent, "none");
  t.true(mock.authCalls.some((c) => c.method === "signOut"));
});

test.serial("leaves a normal profile signed in", async (t) => {
  const { mock } = await renderWithAuth(<Probe />, {
    profile: makeProfile({ display_name: "Jim B.", deleted_at: null }),
  });
  await flush();

  t.is(screen.getByTestId("profile").textContent, "Jim B.");
  t.false(mock.authCalls.some((c) => c.method === "signOut"));
});

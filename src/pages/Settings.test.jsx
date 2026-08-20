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

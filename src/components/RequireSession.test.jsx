import test from "ava";
import { Route, Routes } from "react-router-dom";
import { cleanup, makeProfile, renderWithAuth, screen } from "../../test/setup.jsx";
import RequireSession from "./RequireSession.jsx";

test.afterEach(() => {
  cleanup();
});

function guardedApp() {
  return (
    <Routes>
      <Route element={<RequireSession />}>
        <Route path="/onboarding" element={<div data-testid="onboarding">set up your account</div>} />
      </Route>
      <Route path="/login" element={<div data-testid="login">login screen</div>} />
    </Routes>
  );
}

test.serial("sends a signed-out visitor to /login", async (t) => {
  await renderWithAuth(guardedApp(), { session: null, profile: null, route: "/onboarding" });

  t.truthy(screen.getByTestId("login"));
});

test.serial("lets a signed-in user through even with an incomplete profile", async (t) => {
  // This is the whole point of the lighter guard — /onboarding is where
  // profile_complete gets set, so RequireAuth's redirect would loop here.
  await renderWithAuth(guardedApp(), {
    profile: makeProfile({ profile_complete: false }),
    route: "/onboarding",
  });

  t.truthy(screen.getByTestId("onboarding"));
});

test.serial("renders no bottom nav (onboarding is a standalone screen)", async (t) => {
  await renderWithAuth(guardedApp(), {
    profile: makeProfile({ profile_complete: false }),
    route: "/onboarding",
  });

  t.is(screen.queryByText("Settings"), null);
});

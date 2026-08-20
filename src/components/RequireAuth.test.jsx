import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  makeProfile,
  makeSession,
  renderWithAuth,
  screen,
} from "../../test/setup.jsx";
import RequireAuth from "./RequireAuth.jsx";

test.afterEach(() => {
  cleanup();
});

// RequireAuth is the client-side half of the "no silent fallback" gate: signed
// out -> /login, signed in but onboarding incomplete -> /onboarding.
function guardedApp() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/my-tools" element={<div data-testid="protected">protected screen</div>} />
      </Route>
      <Route path="/login" element={<div data-testid="login">login screen</div>} />
      <Route path="/onboarding" element={<div data-testid="onboarding">onboarding screen</div>} />
    </Routes>
  );
}

test.serial("redirects a signed-out visitor to /login", async (t) => {
  await renderWithAuth(guardedApp(), { session: null, profile: null, route: "/my-tools" });

  t.truthy(screen.getByTestId("login"));
  t.is(screen.queryByTestId("protected"), null);
});

test.serial("redirects to /onboarding when the profile is incomplete", async (t) => {
  await renderWithAuth(guardedApp(), {
    session: makeSession(),
    profile: makeProfile({ profile_complete: false }),
    route: "/my-tools",
  });

  t.truthy(screen.getByTestId("onboarding"));
  t.is(screen.queryByTestId("protected"), null);
});

test.serial("renders the protected screen for a complete profile", async (t) => {
  await renderWithAuth(guardedApp(), { route: "/my-tools" });

  t.truthy(screen.getByTestId("protected"));
});

test.serial("renders the bottom nav alongside the protected screen", async (t) => {
  await renderWithAuth(guardedApp(), { route: "/my-tools" });

  t.truthy(screen.getByText("Settings"));
  t.truthy(screen.getByText("Favorites"));
});

test.serial("falls through to the protected screen when the profile fails to load", async (t) => {
  // Documents current behaviour, and would catch a change to it: the guard
  // checks `profile && !profile.profile_complete`, so a null profile (RLS
  // failure, offline, race) does NOT force onboarding. The server-side RLS
  // policies remain the real gate.
  await renderWithAuth(guardedApp(), {
    session: makeSession(),
    profile: null,
    supabase: { tables: { profiles: { data: null, error: { message: "network" } } } },
    route: "/my-tools",
  });

  t.truthy(screen.getByTestId("protected"));
});

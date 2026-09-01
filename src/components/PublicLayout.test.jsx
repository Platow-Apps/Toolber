import test from "ava";
import { Route, Routes } from "react-router-dom";
import { cleanup, renderWithAuth, screen } from "../../test/setup.jsx";
import PublicLayout from "./PublicLayout.jsx";

test.afterEach(() => {
  cleanup();
});

function publicApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<div data-testid="search">search screen</div>} />
      </Route>
      <Route path="/login" element={<div data-testid="login">login screen</div>} />
      <Route path="/onboarding" element={<div data-testid="onboarding">onboarding screen</div>} />
    </Routes>
  );
}

test.serial("renders its child screen for a signed-out visitor", async (t) => {
  // Search is deliberately browsable without an account — this layout must
  // never redirect the way RequireAuth does.
  await renderWithAuth(publicApp(), { session: null, profile: null });

  t.truthy(screen.getByTestId("search"));
  t.is(screen.queryByTestId("login"), null);
});

test.serial("still shows the bottom nav so the other tabs are reachable", async (t) => {
  await renderWithAuth(publicApp(), { session: null, profile: null });

  t.truthy(screen.getByText("My Tools"));
  t.truthy(screen.getByText("Groups"));
});

test.serial("renders the same for a signed-in visitor", async (t) => {
  await renderWithAuth(publicApp());

  t.truthy(screen.getByTestId("search"));
});

test.serial("sends a signed-in account that never finished setup to onboarding", async (t) => {
  // Confirming a signup email lands here holding an account with no display
  // name. Before this, the person sat on Search with nothing telling them what
  // to do and every tab either bouncing them to /login or doing nothing.
  await renderWithAuth(publicApp(), {
    profile: { id: "u1", display_name: null, profile_complete: false },
  });

  t.truthy(screen.getByTestId("onboarding"));
  t.is(screen.queryByTestId("search"), null);
});

test.serial("does not send a signed-out visitor to onboarding", async (t) => {
  // The redirect keys off the profile, and a signed-out visitor has none —
  // getting this wrong would put a login-ish wall in front of public Search.
  await renderWithAuth(publicApp(), { session: null, profile: null });

  t.is(screen.queryByTestId("onboarding"), null);
  t.truthy(screen.getByTestId("search"));
});

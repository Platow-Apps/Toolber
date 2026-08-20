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

import test from "ava";
import { Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, flush, renderWithAuth, screen } from "../../test/setup.jsx";
import Login from "./Login.jsx";

test.afterEach(() => {
  cleanup();
});

function app() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div data-testid="home">search screen</div>} />
      <Route path="/my-tools" element={<div data-testid="my-tools">my tools</div>} />
    </Routes>
  );
}

async function submit({ email = "user@toolber.test", password = "hunter22" } = {}) {
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: email } });
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
  await flush();
}

test.serial("renders an email and password field", async (t) => {
  await renderWithAuth(app(), { session: null, profile: null, route: "/login" });

  t.truthy(document.querySelector('input[type="email"]'));
  t.truthy(document.querySelector('input[type="password"]'));
});

test.serial("marks both credentials required", async (t) => {
  await renderWithAuth(app(), { session: null, profile: null, route: "/login" });

  t.true(document.querySelector('input[type="email"]').required);
  t.true(document.querySelector('input[type="password"]').required);
});

test.serial("signs in with the typed credentials", async (t) => {
  const { mock } = await renderWithAuth(app(), {
    session: null,
    profile: null,
    route: "/login",
    supabase: { auth: () => ({ data: {}, error: null }) },
  });

  await submit({ email: "jim@toolber.test", password: "correct-horse" });

  t.deepEqual(mock.authCalls, [
    {
      method: "signInWithPassword",
      args: { email: "jim@toolber.test", password: "correct-horse" },
    },
  ]);
});

test.serial("lands on Search after a successful sign-in", async (t) => {
  await renderWithAuth(app(), {
    session: null,
    profile: null,
    route: "/login",
    supabase: { auth: () => ({ data: {}, error: null }) },
  });

  await submit();

  t.truthy(screen.getByTestId("home"));
});

test.serial("surfaces the auth error and stays put", async (t) => {
  await renderWithAuth(app(), {
    session: null,
    profile: null,
    route: "/login",
    supabase: { auth: () => ({ data: {}, error: { message: "Invalid login credentials" } }) },
  });

  await submit();

  t.truthy(screen.getByText("Invalid login credentials"));
  t.is(screen.queryByTestId("home"), null);
});

test.serial("offers a route to sign up", async (t) => {
  await renderWithAuth(app(), { session: null, profile: null, route: "/login" });

  t.is(screen.getByText("Create an account").getAttribute("href"), "/signup");
});

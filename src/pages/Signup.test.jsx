import test from "ava";
import { Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, flush, renderWithAuth, screen } from "../../test/setup.jsx";
import Signup from "./Signup.jsx";

test.afterEach(() => {
  cleanup();
});

function app() {
  return (
    <Routes>
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<div data-testid="onboarding">onboarding</div>} />
    </Routes>
  );
}

async function submit({ email = "new@toolber.test", password = "hunter22" } = {}) {
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: email } });
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  await flush();
}

const render = (supabase) =>
  renderWithAuth(app(), { session: null, profile: null, route: "/signup", supabase });

test.serial("enforces Supabase's six-character password minimum client-side", async (t) => {
  await render();
  t.is(document.querySelector('input[type="password"]').minLength, 6);
});

test.serial("passes the typed credentials to signUp", async (t) => {
  const { mock } = await render({ auth: () => ({ data: { session: null }, error: null }) });

  await submit({ email: "new@toolber.test", password: "hunter22" });

  t.is(mock.authCalls[0].method, "signUp");
  t.is(mock.authCalls[0].args.email, "new@toolber.test");
  t.is(mock.authCalls[0].args.password, "hunter22");
});

test.serial("sends the confirmation link back to this origin", async (t) => {
  const { mock } = await render({ auth: () => ({ data: { session: null }, error: null }) });

  await submit();

  t.is(mock.authCalls[0].args.options.emailRedirectTo, window.location.origin);
});

test.serial("shows the check-your-email screen when no session comes back", async (t) => {
  await render({ auth: () => ({ data: { session: null }, error: null }) });

  await submit({ email: "new@toolber.test" });

  t.truthy(screen.getByText("Check your email"));
  t.truthy(screen.getByText("new@toolber.test"));
});

test.serial("goes straight to onboarding when confirmation is disabled", async (t) => {
  await render({ auth: () => ({ data: { session: { user: { id: "u1" } } }, error: null }) });

  await submit();

  t.truthy(screen.getByTestId("onboarding"));
});

test.serial("surfaces a signup error instead of advancing", async (t) => {
  await render({ auth: () => ({ data: {}, error: { message: "User already registered" } }) });

  await submit();

  t.truthy(screen.getByText("User already registered"));
  t.is(screen.queryByText("Check your email"), null);
});

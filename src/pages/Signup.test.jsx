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

async function submit({ email = "new@toolber.test", password = "hunter22", confirmPassword, confirmAge = true } = {}) {
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: email } });
  // Two password fields now, and they have to match for submit to enable.
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmPassword ?? password } });
  if (confirmAge) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  await flush();
}

const render = (supabase) =>
  renderWithAuth(app(), { session: null, profile: null, route: "/signup", supabase });

test.serial("enforces Supabase's six-character password minimum client-side", async (t) => {
  await render();
  t.is(screen.getByLabelText("Password").minLength, 6);
});

test.serial("blocks submission until the age checkbox is confirmed", async (t) => {
  const { mock } = await render({ auth: () => ({ data: { session: null }, error: null }) });

  await submit({ confirmAge: false });

  t.false(mock.authCalls.some((c) => c.method === "signUp"));
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

// ── Confirm password, and the show/hide toggle ──────────────────────────

test.serial("won't submit while the two passwords differ", async (t) => {
  const { mock } = await render({ auth: () => ({ data: { session: null }, error: null }) });

  await submit({ password: "hunter22", confirmPassword: "hunter23" });

  t.false(mock.authCalls.some((c) => c.method === "signUp"));
  t.truthy(screen.getByText(/passwords don't match/i));
});

test.serial("says nothing about matching until the second box is used", async (t) => {
  // Flagging a mismatch on the first keystroke of the confirm field would
  // mean the error is visible for almost the whole time someone is typing.
  await render();

  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
  t.is(screen.queryByText(/passwords don't match/i), null);
});

test.serial("reveals and re-hides the password on request", async (t) => {
  await render();

  const field = screen.getByLabelText("Password");
  t.is(field.type, "password");

  fireEvent.click(screen.getAllByRole("button", { name: /show password/i })[0]);
  t.is(screen.getByLabelText("Password").type, "text");

  fireEvent.click(screen.getAllByRole("button", { name: /hide password/i })[0]);
  t.is(screen.getByLabelText("Password").type, "password");
});

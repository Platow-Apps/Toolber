import test from "ava";
import { cleanup, fireEvent, flush, renderWithAuth, screen } from "../../test/setup.jsx";
import GoogleSignIn from "./GoogleSignIn.jsx";

test.afterEach.always(() => {
  cleanup();
});

const render = (auth) =>
  renderWithAuth(<GoogleSignIn />, { session: null, profile: null, supabase: { auth } });

test.serial("offers one button, worded the same for signing in and signing up", async (t) => {
  // With OAuth those are the same action: Google says who you are, and
  // whether an account already exists is our lookup, not the person's choice.
  await render();

  t.truthy(screen.getByRole("button", { name: /Continue with Google/i }));
});

test.serial("asks Supabase for Google, and to come back where we started", async (t) => {
  // Back to this origin rather than the configured Site URL, so a preview
  // deploy returns to itself instead of to production.
  const calls = [];
  await render((method, args) => {
    calls.push({ method, args });
    return { data: null, error: null };
  });

  fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));
  await flush();

  const call = calls.find((c) => c.method === "signInWithOAuth");
  t.truthy(call);
  t.is(call.args.provider, "google");
  t.is(call.args.options.redirectTo, `${window.location.origin}/`);
});

test.serial("shows why it failed rather than looking like a dead button", async (t) => {
  // The browser normally leaves for Google and this component is gone, so the
  // only thing that ever gets here is a failure — and silence would read as
  // a button that does nothing.
  await render(() => ({ data: null, error: { message: "Unsupported provider" } }));

  fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));
  await flush();

  t.truthy(screen.getByText("Unsupported provider"));
});

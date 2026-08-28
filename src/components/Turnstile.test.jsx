import test from "ava";
import { cleanup, renderWithRouter } from "../../test/setup.jsx";
import Turnstile from "./Turnstile.jsx";

// The component reads VITE_TURNSTILE_SITE_KEY from import.meta.env, which the
// test runner leaves undefined — so it renders nothing here and the reset
// behaviour can't be driven end to end. What these cover is the contract that
// matters: it must stay inert when unconfigured, and must never blow up when
// asked to reset a widget that was never rendered.

test.afterEach(() => {
  cleanup();
});

test.serial("renders nothing at all when no site key is configured", (t) => {
  // Signup and login have to keep working before the Turnstile account setup
  // is done — that dormancy is the whole design of this component.
  const { container } = renderWithRouter(<Turnstile onToken={() => {}} />);
  t.is(container.innerHTML, "");
});

test.serial("a reset with no rendered widget is a no-op, not a crash", (t) => {
  // resetSignal is bumped from a failed-auth handler, which can fire before
  // the Turnstile script has loaded (or when it never loads at all).
  const { rerender, container } = renderWithRouter(
    <Turnstile onToken={() => {}} resetSignal={0} />
  );
  t.notThrows(() => rerender(<Turnstile onToken={() => {}} resetSignal={1} />));
  t.is(container.innerHTML, "");
});

test.serial("does not clear the token on first render", (t) => {
  // resetSignal starts at 0 and must not be read as "a token was just spent",
  // or the very first submit would have its token wiped before it was sent.
  let cleared = false;
  renderWithRouter(
    <Turnstile
      onToken={(token) => {
        if (token === null) cleared = true;
      }}
      resetSignal={0}
    />
  );
  t.false(cleared);
});

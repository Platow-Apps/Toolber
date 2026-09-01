import test from "ava";
import { cleanup, renderWithRouter, screen } from "../../test/setup.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

test.afterEach(() => {
  cleanup();
});

function Boom({ message }) {
  throw new Error(message);
}

// React logs the caught error to console.error regardless of the boundary,
// which is just noise in the test output.
function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

const boom = (message) =>
  quietly(() =>
    renderWithRouter(
      <ErrorBoundary>
        <Boom message={message} />
      </ErrorBoundary>
    )
  );

test.serial("says Error, and points at a real address to send a screenshot to", (t) => {
  // "Something broke" told a neighbor nothing and offered them nowhere to go.
  boom("kaboom");

  t.truthy(screen.getByText("Error"));
  t.truthy(screen.getByText(/send us a screenshot/i));
  t.truthy(screen.getByRole("link", { name: /support@toolber.org/i }));
  t.is(screen.queryByText(/something broke/i), null);
});

test.serial("offers a refresh, not only a trip back to Search", (t) => {
  // Reloading is what actually clears most of these, so it is the primary
  // action rather than a line of advice with no button attached.
  boom("kaboom");

  t.truthy(screen.getByRole("button", { name: /refresh/i }));
  t.truthy(screen.getByRole("button", { name: /back to search/i }));
});

test.serial("shows something screenshot-worthy rather than a bare apology", (t) => {
  // The copy asks for a screenshot; without this the screenshot carries no
  // information at all.
  boom("profiles.display_name is not a function");

  t.truthy(screen.getByText(/profiles\.display_name is not a function/));
});

test.serial("explains a stale-chunk failure in words instead of a URL", (t) => {
  // A deploy replaces the hashed chunk files, so a tab left open across one
  // asks for a module that no longer exists. It is nobody's fault and always
  // fixed by reloading, but the raw message is unreadable.
  boom("Failed to fetch dynamically imported module: https://toolber.org/assets/ToolMap-a1b2c3.js");

  t.truthy(screen.getByText(/The app updated while this tab was open/i));
  t.is(screen.queryByText(/ToolMap-a1b2c3/), null);
});

test.serial("truncates a runaway message rather than filling the screen", (t) => {
  boom("x".repeat(500));

  const shown = screen.getByText(/^x+…$/);
  t.true(shown.textContent.length < 250);
});

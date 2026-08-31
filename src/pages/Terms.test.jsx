import test from "ava";
import { cleanup, renderWithAuth, screen } from "../../test/setup.jsx";
import Privacy from "./Privacy.jsx";
import Terms, { TERMS_VERSION } from "./Terms.jsx";

test.afterEach(() => {
  cleanup();
});

// These pages are reachable with no account at all — that is the point of
// them, since the signup form links to them.
const renderSignedOut = (el) => renderWithAuth(el, { session: null, profile: null });

test.serial("terms render for a signed-out visitor", async (t) => {
  // Signup links here, so these must render before anyone has an account.
  await renderSignedOut(<Terms />);
  t.truthy(screen.getByText("Terms of Service"));
});

test.serial("privacy renders for a signed-out visitor", async (t) => {
  await renderSignedOut(<Privacy />);
  t.truthy(screen.getByText("Privacy Policy"));
});

test.serial("both say plainly that they are unreviewed drafts", async (t) => {
  // Nobody — least of all a neighbor relying on it — should mistake this for
  // a reviewed document while the placeholders are still in it.
  await renderSignedOut(<Terms />);
  t.truthy(screen.getByText(/not yet reviewed by an attorney/i));
  cleanup();

  await renderSignedOut(<Privacy />);
  t.truthy(screen.getByText(/not yet reviewed by an attorney/i));
});

test.serial("the accepted version is the version the page shows", async (t) => {
  // Onboarding records TERMS_VERSION against the user. If the page and the
  // recorded value drift, the acceptance record becomes meaningless.
  await renderSignedOut(<Terms />);
  t.truthy(screen.getByText(new RegExp(`Version ${TERMS_VERSION}`)));
});

test.serial("terms state the liability position rather than burying it", async (t) => {
  await renderSignedOut(<Terms />);
  // The durable framing: not a party to the loan, so responsibility sits with
  // the two people who actually control the tool.
  t.truthy(screen.getByText(/not a party to your loan/i));
  t.truthy(screen.getByText(/cannot issue\s+refunds/i));
});

test.serial("does not claim a blanket waiver it could not enforce", async (t) => {
  // A disclaimer that reads as absolute is the fragile kind. These carve-outs
  // are what keep the rest of the section standing if one part is struck.
  await renderSignedOut(<Terms />);
  t.truthy(screen.getByText(/gross negligence, willful misconduct, or fraud/i));
  t.truthy(screen.getByText(/the rest stays in\s+force/i));
});

test.serial("offers a way out of arbitration", async (t) => {
  // An opt-out window is a large part of what makes a consumer arbitration
  // clause enforceable at all.
  await renderSignedOut(<Terms />);
  t.truthy(screen.getByText(/opt out of arbitration/i));
  t.truthy(screen.getByText(/Small claims are the exception/i));
});

test.serial("privacy states the two protections that actually matter", async (t) => {
  await renderSignedOut(<Privacy />);
  t.truthy(screen.getByText(/home coordinates are never shown to anyone/i));
  t.truthy(screen.getByText(/only with someone whose borrow\s+request you personally approved/i));
});

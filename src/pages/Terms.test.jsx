import test from "ava";
import { cleanup, renderWithAuth, screen } from "../../test/setup.jsx";
import Privacy from "./Privacy.jsx";
import Terms, { TERMS_VERSION } from "./Terms.jsx";

test.afterEach(() => {
  cleanup();
});

// These pages are reachable with no account at all — that is the point of
// them, since the signup form links to them.
// Several of these phrases are bolded, so the <b> and its parent <p> both
// match and getByText throws on the ambiguity. What matters is that the words
// are on the page at all.
const present = (pattern) => screen.getAllByText(pattern).length > 0;

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

test.serial("keeps non-waivable state consumer rights, by name", async (t) => {
  // A Delaware choice-of-law clause cannot reach these, so claiming otherwise
  // is what gets a clause struck. Naming them is the point -- California
  // courts enforce the CLRA, the UCL and public injunctive relief regardless
  // of what the contract says.
  await renderSignedOut(<Terms />);
  t.true(present(/Consumers Legal Remedies Act/));
  t.true(present(/Unfair Competition Law/));
  t.true(present(/public injunctive relief/));
});

test.serial("names a real administrator, and the consumer rule set", async (t) => {
  // The commercial rules lack the consumer due-process protections courts
  // look for, so which rule set is named genuinely matters.
  await renderSignedOut(<Terms />);
  t.true(present(/American Arbitration Association/));
  t.true(present(/Consumer Arbitration Rules/));
  t.true(present(/not its commercial rules/i));
});

test.serial("does not make anyone travel to Delaware to arbitrate", async (t) => {
  // The AAA's own consumer standard. Without it, the venue clause is the
  // weakest part of the whole section.
  await renderSignedOut(<Terms />);
  t.true(present(/reasonably convenient to you/i));
  t.true(present(/county where you live/i));
  t.true(present(/written submissions alone/i));
});

test.serial("has no bracketed placeholders left in the rendered text", async (t) => {
  // The document cannot ship with one, and a placeholder is easy to miss in
  // a page this long.
  await renderSignedOut(<Terms />);
  t.is(screen.queryByText(/attorney to specify/i), null);
  t.false(/\[[A-Z]{2,}/.test(document.body.textContent));
});

test.serial("privacy states the two protections that actually matter", async (t) => {
  await renderSignedOut(<Privacy />);
  t.truthy(screen.getByText(/home coordinates are never shown to anyone/i));
  t.truthy(screen.getByText(/only with someone whose borrow\s+request you personally approved/i));
});

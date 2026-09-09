import test from "ava";
import { cleanup, renderWithAuth, screen } from "../../test/setup.jsx";
import Guide from "./Guide.jsx";

test.afterEach.always(() => {
  cleanup();
});

// Reachable with no account at all — that is the point of it, since signup
// links here. Several phrases are bolded, so the <b> and its parent both match
// and getByText throws on the ambiguity; what matters is the words being there.
const renderSignedOut = () => renderWithAuth(<Guide />, { session: null, profile: null });
const present = (pattern) => screen.getAllByText(pattern).length > 0;

test.serial("reads without an account, because that is when the question comes up", async (t) => {
  // "What does this do with my address" is asked before anyone hands one over,
  // so this renders with no session, like the legal pages.
  await renderSignedOut();

  t.truthy(screen.getByText("Using Toolber"));
});

test.serial("carries no version stamp, because nobody accepts it", async (t) => {
  // The shell is shared with Terms and Privacy. Stamping this one would imply
  // it is a document of record, which it is not.
  await renderSignedOut();

  t.is(screen.queryByText(/^Version /i), null);
});

test.serial("says plainly that approving does not disclose an address", async (t) => {
  // The single most surprising thing about the app, and the one people work
  // out at the worst possible moment.
  await renderSignedOut();

  t.true(present(/Approving is not the same as sharing your address/i));
});

test.serial("explains that the map pin is not the house", async (t) => {
  await renderSignedOut();

  t.true(present(/The map pin is not your house/i));
});

test.serial("does not promise anyone is safe", async (t) => {
  // Habits, not assurances. A guarantee here would be false and would sit
  // badly against Terms that say Platow is not part of the loan.
  await renderSignedOut();

  t.true(present(/none of it is a guarantee/i));
  t.true(present(/carries no insurance/i));
});

test.serial("defers to the Terms rather than restating them", async (t) => {
  // Two documents describing one obligation in different words is how they
  // end up contradicting each other.
  await renderSignedOut();

  t.true(present(/Where this page and those disagree, those win/i));
  t.is(screen.getAllByRole("link", { name: /Terms/i })[0].getAttribute("href"), "/terms");
});

test.serial("answers how an invite code is actually used", async (t) => {
  await renderSignedOut();

  t.true(present(/Have an invite code\?/i));
});

test.serial("does not describe itself in the language of finance", async (t) => {
  // "No company in the middle of the loan" read as a statement about money
  // rather than about tools, and said nothing the liability section does not
  // say better.
  await renderSignedOut();

  t.is(screen.queryByText(/no company in the middle/i), null);
});

test.serial("walks through listing a tool, in order", async (t) => {
  // The rest of the page explains how Toolber works; this is the part that
  // says which buttons to press.
  await renderSignedOut();

  t.truthy(screen.getByText("How to list a tool"));
  t.true(present(/tap List Something/i));
  t.true(present(/Tap List This Tool/i));
});

test.serial("walks through borrowing one", async (t) => {
  await renderSignedOut();

  t.truthy(screen.getByText("How to borrow a tool"));
  t.true(present(/Tap Request Borrow/i));
  t.true(present(/tap Request pickup/i));
});

test.serial("the steps are numbered, because they happen in an order", async (t) => {
  // Bulleted lists elsewhere are sets of things all true at once. A
  // walkthrough is not one of those, and a number is what makes a step
  // referable when someone is stuck on it.
  await renderSignedOut();

  t.true(screen.getAllByRole("list").some((el) => el.tagName === "OL"));
});

test.serial("names the buttons the app actually shows", async (t) => {
  // A walkthrough that half-matches the UI is worse than none: it makes
  // someone doubt they are on the right screen.
  await renderSignedOut();

  for (const label of [/List Something/, /Request Borrow/, /Request pickup/, /Mark tool returned/]) {
    t.true(present(label), String(label));
  }
});

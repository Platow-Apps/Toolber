import test from "ava";
import { cleanup, fireEvent, flush, renderWithRouter, screen } from "../../test/setup.jsx";
import PushPrompt from "./PushPrompt.jsx";

test.afterEach.always(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // Nothing to clear.
  }
});

test.serial("asks before the browser does", async (t) => {
  // The whole point of the card. jsdom has no PushManager, so enablePush()
  // returns "unsupported" — but crucially it is only reached by a tap, which
  // is what keeps the browser's one-shot prompt out of a page load.
  renderWithRouter(<PushPrompt onClose={() => {}} />);

  t.truthy(screen.getByText("Want push notifications?"));
  t.truthy(screen.getByRole("button", { name: /turn on/i }));
  t.truthy(screen.getByRole("button", { name: /not now/i }));
});

test.serial("says email keeps working, so declining costs nothing", async (t) => {
  renderWithRouter(<PushPrompt onClose={() => {}} />);
  t.truthy(screen.getByText(/email\s+keeps working either way/i));
});

test.serial("Not now closes it and is remembered, so it is not asked every time", async (t) => {
  // Offering again after every borrow request would be the nagging that makes
  // people deny permission outright. Counted rather than permanent: this card
  // raises no browser prompt, so one decline should not end the matter.
  let closed = false;
  renderWithRouter(<PushPrompt onClose={() => { closed = true; }} />);

  fireEvent.click(screen.getByRole("button", { name: /not now/i }));
  await flush();

  t.true(closed);
  t.is(JSON.parse(window.localStorage.getItem("toolber:pushPromptDismissed")).count, 1);
});

test.serial("Turn on does not record a dismissal", async (t) => {
  // Turning it on and having it fail is not a "no" — the offer should still
  // be available next time.
  renderWithRouter(<PushPrompt onClose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
  await flush();

  t.is(window.localStorage.getItem("toolber:pushPromptDismissed"), null);
});

test.serial("stays open and explains when turning it on fails", async (t) => {
  // Closing on failure would take the only explanation with it, leaving
  // someone who tapped Turn on with nothing to show for it.
  let closed = false;
  renderWithRouter(<PushPrompt onClose={() => { closed = true; }} />);

  fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
  await flush();

  t.false(closed);
  // jsdom reports no push support, which is the iPhone-in-Safari case.
  t.truthy(screen.getByText(/home screen/i));
});

test.serial("is a labelled dialog", async (t) => {
  renderWithRouter(<PushPrompt onClose={() => {}} />);

  const dialog = screen.getByRole("dialog");
  t.is(dialog.getAttribute("aria-modal"), "true");
  t.is(dialog.getAttribute("aria-labelledby"), "push-prompt-title");
});

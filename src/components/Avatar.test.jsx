import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen, setSupabaseMock } from "../../test/setup.jsx";
import Avatar from "./Avatar.jsx";

test.beforeEach(() => {
  setSupabaseMock({
    storage: (bucket) => ({
      getPublicUrl(path) {
        return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
      },
    }),
  });
});

test.afterEach(() => {
  cleanup();
});

test.serial("shows the picture when there is one", (t) => {
  renderWithRouter(<Avatar path="u1/pic.jpg" name="Mr. Miyagi" />);

  const img = screen.getByRole("img");
  t.is(img.src, "https://cdn.test/avatars/u1/pic.jpg");
  t.is(img.alt, "Mr. Miyagi's profile picture");
});

test.serial("falls back to the first letter when there is no picture", (t) => {
  renderWithRouter(<Avatar path={null} name="Mr. Miyagi" />);

  t.is(screen.queryByRole("img"), null);
  t.truthy(screen.getByText("M"));
});

test.serial("uppercases a lowercase name", (t) => {
  renderWithRouter(<Avatar path={null} name="jim b." />);
  t.truthy(screen.getByText("J"));
});

test.serial("shows a question mark rather than nothing for a nameless profile", (t) => {
  // Reachable before onboarding sets a display name. An empty circle reads as
  // a broken layout.
  renderWithRouter(<Avatar path={null} name={null} />);
  t.truthy(screen.getByText("?"));
});

test.serial("ignores leading whitespace when picking the letter", (t) => {
  renderWithRouter(<Avatar path={null} name="  Ada" />);
  t.truthy(screen.getByText("A"));
});

test.serial("falls back to the letter if the picture will not load", (t) => {
  // A stored path can outlive its file — a deleted object, a bucket change.
  // A broken-image icon next to someone's name is worse than the letter it
  // replaced.
  renderWithRouter(<Avatar path="u1/gone.jpg" name="Ada" />);

  fireEvent.error(screen.getByRole("img"));

  t.is(screen.queryByRole("img"), null);
  t.truthy(screen.getByText("A"));
});

test.serial("gives a later picture its own chance to load", (t) => {
  // Without the reset, one broken image would pin every subsequent photo
  // shown by the same element to the letter.
  const { rerender } = renderWithRouter(<Avatar path="u1/gone.jpg" name="Ada" />);
  fireEvent.error(screen.getByRole("img"));
  t.is(screen.queryByRole("img"), null);

  rerender(<Avatar path="u1/new.jpg" name="Ada" />);
  t.is(screen.getByRole("img").src, "https://cdn.test/avatars/u1/new.jpg");
});

test.serial("takes its size from the caller", (t) => {
  // 44px in the nav and 64px on Settings are the same component scaled, so
  // sizing has to stay the caller's business.
  renderWithRouter(<Avatar path={null} name="Ada" className="h-16 w-16" />);

  const classes = screen.getByText("A").className.split(" ");
  t.true(classes.includes("h-16"));
  t.true(classes.includes("w-16"));
});

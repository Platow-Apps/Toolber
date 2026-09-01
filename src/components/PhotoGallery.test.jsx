import test from "ava";
import { cleanup, renderWithRouter, screen, setSupabaseMock } from "../../test/setup.jsx";
import PhotoGallery from "./PhotoGallery.jsx";

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

test.serial("renders nothing for a tool with no photos", (t) => {
  const { container } = renderWithRouter(<PhotoGallery photos={[]} />);
  t.is(container.innerHTML, "");
});

test.serial("renders every photo as an image", (t) => {
  renderWithRouter(<PhotoGallery photos={["u/a.jpg", "u/b.jpg"]} />);

  const images = screen.getAllByRole("img");
  t.is(images.length, 2);
  t.is(images[0].src, "https://cdn.test/tool-photos/u/a.jpg");
  t.is(images[1].src, "https://cdn.test/tool-photos/u/b.jpg");
});

test.serial("sits photos next to each other rather than one per swipe", (t) => {
  // w-full made a portrait photo float in the middle of a wide box with big
  // empty margins, and hid the second photo behind a swipe. Auto width lets
  // both be visible and legible at once.
  const { container } = renderWithRouter(<PhotoGallery photos={["u/a.jpg", "u/b.jpg"]} />);

  const images = [...container.querySelectorAll("img")];
  t.is(images.length, 2);
  for (const img of images) {
    // Exact tokens: max-w-full legitimately contains "w-full".
    const classes = img.className.split(" ");
    t.true(classes.includes("w-auto"), "photos must size to their own width");
    t.false(classes.includes("w-full"), "w-full is what created the dead space");
  }
});

test.serial("never crops a photo", (t) => {
  // object-cover showed a zoomed slice of a portrait photo's middle, which is
  // useless for judging a tool.
  const { container } = renderWithRouter(<PhotoGallery photos={["u/a.jpg"]} />);

  const classes = container.querySelector("img").className.split(" ");
  t.true(classes.includes("object-contain"));
  t.false(classes.includes("object-cover"));
});

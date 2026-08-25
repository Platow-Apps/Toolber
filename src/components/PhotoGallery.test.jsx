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

test.serial("shows a dot indicator only when there's more than one photo", (t) => {
  const { container: single } = renderWithRouter(<PhotoGallery photos={["u/a.jpg"]} />);
  t.is(single.querySelectorAll(".rounded-full").length, 0);
  cleanup();

  const { container: multi } = renderWithRouter(<PhotoGallery photos={["u/a.jpg", "u/b.jpg"]} />);
  t.is(multi.querySelectorAll(".rounded-full").length, 2);
});

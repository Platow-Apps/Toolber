import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen } from "../../test/setup.jsx";
import ToolThumb from "./ToolThumb.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("loads the small thumbnail, not the full-size photo", (t) => {
  renderWithRouter(<ToolThumb path="user-1/a.jpg" alt="Wet tile saw" />);

  const img = screen.getByAltText("Wet tile saw");
  t.is(img.src, "https://example.test/tool-photos/user-1/a.thumb.jpg");
});

test.serial("falls back to the full photo when the thumbnail is missing", (t) => {
  // Every photo uploaded before thumbnails existed is permanently in this
  // state — there's no backfill — so this path is the norm for older
  // listings, not an edge case.
  renderWithRouter(<ToolThumb path="user-1/legacy.jpg" alt="Old ladder" />);

  const img = screen.getByAltText("Old ladder");
  fireEvent.error(img);

  t.is(screen.getByAltText("Old ladder").src, "https://example.test/tool-photos/user-1/legacy.jpg");
});

test.serial("renders nothing at all without a path", (t) => {
  const { container } = renderWithRouter(<ToolThumb path={null} alt="none" />);
  t.is(container.querySelector("img"), null);
});

test.serial("retries the thumbnail when shown a different photo", (t) => {
  // One missing thumbnail must not pin the element to full-size images for
  // every photo it is later reused for.
  const { rerender } = renderWithRouter(<ToolThumb path="user-1/legacy.jpg" alt="pic" />);
  fireEvent.error(screen.getByAltText("pic"));
  t.is(screen.getByAltText("pic").src, "https://example.test/tool-photos/user-1/legacy.jpg");

  rerender(<ToolThumb path="user-1/fresh.jpg" alt="pic" />);
  t.is(screen.getByAltText("pic").src, "https://example.test/tool-photos/user-1/fresh.thumb.jpg");
});

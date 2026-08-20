import test from "ava";
import { cleanup, renderWithRouter, screen } from "../../test/setup.jsx";
import SearchTagline from "./SearchTagline.jsx";

test.afterEach(() => {
  cleanup();
});

// The phrase order is a locked spec (docs/feature-checklist.md). These tests
// pin the parts that are observable without driving the 6s timers.

test.serial('opens on the locked first phrase, "Why buy? Borrow."', (t) => {
  renderWithRouter(<SearchTagline />);
  t.truthy(screen.getByText("Why buy? Borrow."));
});

test.serial("shows exactly one phrase at a time", (t) => {
  renderWithRouter(<SearchTagline />);
  // Every other phrase in the list must be absent while the first is showing.
  for (const other of ["Neighborhood tool lending app", "Power Tools", "Industrial"]) {
    t.is(screen.queryByText(other), null);
  }
});

test.serial("renders no icon for the first phrase", (t) => {
  const { container } = renderWithRouter(<SearchTagline />);
  t.is(container.querySelectorAll("svg").length, 0);
});

test.serial("starts visible rather than faded out", (t) => {
  renderWithRouter(<SearchTagline />);
  const wrapper = screen.getByText("Why buy? Borrow.").parentElement;
  t.is(wrapper.style.opacity, "1");
});

import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen } from "../../test/setup.jsx";
import { TABS } from "./BottomNav.jsx";
import BrandBar from "./BrandBar.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("renders the wordmark as a link home", (t) => {
  renderWithRouter(<BrandBar />);
  const wordmark = screen.getByText("Toolber");
  t.is(wordmark.closest("a").getAttribute("href"), "/");
});

test.serial("renders the mascot icon as a second, labelled link home", (t) => {
  renderWithRouter(<BrandBar />);
  const icon = screen.getByLabelText("Go to home");
  t.is(icon.getAttribute("href"), "/");
});

test.serial("keeps the dropdown closed until hover", (t) => {
  renderWithRouter(<BrandBar />);
  t.is(screen.queryByText("My Tools"), null);
});

test.serial("opens the dropdown on hover and closes it on leave", (t) => {
  renderWithRouter(<BrandBar />);
  const hoverTarget = screen.getByLabelText("Go to home").parentElement;

  fireEvent.mouseEnter(hoverTarget);
  t.truthy(screen.getByText("My Tools"));

  fireEvent.mouseLeave(hoverTarget);
  t.is(screen.queryByText("My Tools"), null);
});

test.serial("the dropdown mirrors the bottom nav exactly", (t) => {
  // BrandBar imports TABS rather than keeping a second copy — this is the test
  // that would fail if someone reintroduced a hand-maintained duplicate.
  renderWithRouter(<BrandBar />);
  fireEvent.mouseEnter(screen.getByLabelText("Go to home").parentElement);

  for (const tab of TABS) {
    const label = tab.to === "/" ? "Search" : tab.label;
    const link = screen.getByText(label).closest("a");
    t.is(link.getAttribute("href"), tab.to);
  }
});

test.serial("renders the optional middle slot", (t) => {
  renderWithRouter(
    <BrandBar>
      <span data-testid="slot">tagline goes here</span>
    </BrandBar>
  );
  t.truthy(screen.getByTestId("slot"));
});

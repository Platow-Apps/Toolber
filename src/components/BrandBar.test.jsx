import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen } from "../../test/setup.jsx";
import { TABS } from "./BottomNav.jsx";
import BrandBar from "./BrandBar.jsx";

test.afterEach(() => {
  cleanup();
});

const menuButton = () => screen.getByRole("button", { name: "Open navigation menu" });

test.serial("renders the wordmark as a link home", (t) => {
  renderWithRouter(<BrandBar />);
  const wordmark = screen.getByText("Toolber");
  t.is(wordmark.closest("a").getAttribute("href"), "/");
});

test.serial("keeps the menu closed until asked", (t) => {
  renderWithRouter(<BrandBar />);
  t.is(screen.queryByRole("menu"), null);
  t.is(menuButton().getAttribute("aria-expanded"), "false");
});

test.serial("opens the menu on click — not hover alone", (t) => {
  // Hover-only menus don't exist on touch devices and can't be reached by
  // keyboard, which is why this is a button.
  renderWithRouter(<BrandBar />);

  fireEvent.click(menuButton());

  t.truthy(screen.getByRole("menu"));
  t.is(menuButton().getAttribute("aria-expanded"), "true");
  t.truthy(screen.getByText("My Tools"));
});

test.serial("closes the menu on a second click", (t) => {
  renderWithRouter(<BrandBar />);

  fireEvent.click(menuButton());
  fireEvent.click(menuButton());

  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu on Escape", (t) => {
  renderWithRouter(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.keyDown(document, { key: "Escape" });

  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu when the pointer goes elsewhere", (t) => {
  renderWithRouter(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.pointerDown(document.body);

  t.is(screen.queryByRole("menu"), null);
});

test.serial("still opens on hover for pointer users", (t) => {
  renderWithRouter(<BrandBar />);
  const wrapper = menuButton().parentElement;

  fireEvent.mouseEnter(wrapper);
  t.truthy(screen.getByRole("menu"));

  fireEvent.mouseLeave(wrapper);
  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu after navigating", (t) => {
  renderWithRouter(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.click(screen.getByText("Groups"));

  t.is(screen.queryByRole("menu"), null);
});

test.serial("the menu mirrors the bottom nav exactly", (t) => {
  // BrandBar imports TABS rather than keeping a second copy — this is the test
  // that would fail if someone reintroduced a hand-maintained duplicate.
  renderWithRouter(<BrandBar />);
  fireEvent.click(menuButton());

  const items = screen.getAllByRole("menuitem");
  t.is(items.length, TABS.length);
  for (const tab of TABS) {
    const label = tab.to === "/" ? "Search" : tab.label;
    t.is(screen.getByText(label).closest("a").getAttribute("href"), tab.to);
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

import test from "ava";
import { cleanup, COLOR, renderWithRouter, screen } from "../../test/setup.jsx";
import BottomNav, { TABS } from "./BottomNav.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("renders every tab exactly once", (t) => {
  renderWithRouter(<BottomNav />);
  for (const tab of TABS) {
    t.is(screen.getAllByText(tab.label).length, 1, `expected one "${tab.label}" link`);
  }
});

test.serial("links each tab to its own route", (t) => {
  renderWithRouter(<BottomNav />);
  for (const tab of TABS) {
    const link = screen.getByText(tab.label).closest("a");
    t.is(link.getAttribute("href"), tab.to);
  }
});

test.serial("marks only the current route as active", (t) => {
  renderWithRouter(<BottomNav />, { route: "/groups" });
  // Active tabs are coloured safety yellow via an inline style — the one signal
  // that survives into jsdom (Tailwind classes aren't compiled here).
  t.is(screen.getByText("Groups").style.color, COLOR.active);
  t.is(screen.getByText("Search").style.color, COLOR.inactive);
});

test.serial("the Search tab uses `end` so it does not match every route", (t) => {
  // Without `end: true` the "/" NavLink would light up on every screen.
  const search = TABS.find((tab) => tab.to === "/");
  t.true(search.end);

  renderWithRouter(<BottomNav />, { route: "/favorites" });
  t.is(screen.getByText("Search").style.color, COLOR.inactive);
  t.is(screen.getByText("Favorites").style.color, COLOR.active);
});

test.serial("exposes the tab list for reuse so BrandBar cannot drift", (t) => {
  t.true(Array.isArray(TABS));
  t.deepEqual(
    TABS.map((tab) => tab.to),
    ["/", "/my-tools", "/groups", "/favorites", "/settings"]
  );
});

import test from "ava";
import { cleanup, fireEvent, renderWithAuth, screen } from "../../test/setup.jsx";
import { TABS } from "./BottomNav.jsx";
import BrandBar from "./BrandBar.jsx";

// BrandBar now renders NotificationBell, which calls useAuth() — no longer a
// purely presentational component, so these need real auth context
// (renderWithAuth) rather than the bare renderWithRouter. NotificationBell's
// own behavior is covered separately in NotificationBell.test.jsx.

test.afterEach(() => {
  cleanup();
});

const menuButton = () => screen.getByRole("button", { name: "Open navigation menu" });

test.serial("renders the wordmark as a link home", async (t) => {
  await renderWithAuth(<BrandBar />);
  const wordmark = screen.getByText("Toolber");
  t.is(wordmark.closest("a").getAttribute("href"), "/");
});

test.serial("keeps the menu closed until asked", async (t) => {
  await renderWithAuth(<BrandBar />);
  t.is(screen.queryByRole("menu"), null);
  t.is(menuButton().getAttribute("aria-expanded"), "false");
});

test.serial("opens the menu on click — not hover alone", async (t) => {
  // Hover-only menus don't exist on touch devices and can't be reached by
  // keyboard, which is why this is a button.
  await renderWithAuth(<BrandBar />);

  fireEvent.click(menuButton());

  t.truthy(screen.getByRole("menu"));
  t.is(menuButton().getAttribute("aria-expanded"), "true");
  t.truthy(screen.getByText("My Tools"));
});

test.serial("closes the menu on a second click", async (t) => {
  await renderWithAuth(<BrandBar />);

  fireEvent.click(menuButton());
  fireEvent.click(menuButton());

  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu on Escape", async (t) => {
  await renderWithAuth(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.keyDown(document, { key: "Escape" });

  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu when the pointer goes elsewhere", async (t) => {
  await renderWithAuth(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.pointerDown(document.body);

  t.is(screen.queryByRole("menu"), null);
});

test.serial("still opens on hover for pointer users", async (t) => {
  await renderWithAuth(<BrandBar />);
  const wrapper = menuButton().parentElement;

  fireEvent.mouseEnter(wrapper);
  t.truthy(screen.getByRole("menu"));

  fireEvent.mouseLeave(wrapper);
  t.is(screen.queryByRole("menu"), null);
});

test.serial("closes the menu after navigating", async (t) => {
  await renderWithAuth(<BrandBar />);
  fireEvent.click(menuButton());

  fireEvent.click(screen.getByText("Groups"));

  t.is(screen.queryByRole("menu"), null);
});

test.serial("the menu mirrors the bottom nav exactly", async (t) => {
  // BrandBar imports TABS rather than keeping a second copy — this is the test
  // that would fail if someone reintroduced a hand-maintained duplicate.
  await renderWithAuth(<BrandBar />);
  fireEvent.click(menuButton());

  const items = screen.getAllByRole("menuitem");
  t.is(items.length, TABS.length);
  for (const tab of TABS) {
    const label = tab.to === "/" ? "Search" : tab.label;
    t.is(screen.getByText(label).closest("a").getAttribute("href"), tab.to);
  }
});

test.serial("renders the optional middle slot", async (t) => {
  await renderWithAuth(
    <BrandBar>
      <span data-testid="slot">tagline goes here</span>
    </BrandBar>
  );
  t.truthy(screen.getByTestId("slot"));
});

test.serial("renders no notification bell for a signed-out visitor", async (t) => {
  // BrandBar sits on Search too, which is public — a signed-out visitor
  // should see the nav menu but no bell (NotificationBell returns null
  // without a user).
  await renderWithAuth(<BrandBar />, { session: null, profile: null });
  t.is(screen.queryByRole("button", { name: /Notifications/i }), null);
  t.truthy(menuButton());
});

test.serial("shows the signed-in user's first name", async (t) => {
  await renderWithAuth(<BrandBar />); // default profile: display_name "Test User"
  t.truthy(screen.getByText("Test"));
  t.is(screen.queryByText("Test User"), null);
});

test.serial("shows no name for a signed-out visitor", async (t) => {
  await renderWithAuth(<BrandBar />, { session: null, profile: null });
  t.is(screen.queryByText("Test"), null);
});

test.serial("shows no name pre-onboarding, before display_name is set", async (t) => {
  await renderWithAuth(<BrandBar />, { profile: { id: "11111111-1111-1111-1111-111111111111", display_name: null } });
  t.is(screen.queryByText("Test"), null);
});

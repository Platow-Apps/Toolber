import test from "ava";
import { cleanup, fireEvent, flush, makeProfile, renderWithAuth, screen } from "../../test/setup.jsx";
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

test.serial("shows the signed-in user's whole display name", async (t) => {
  await renderWithAuth(<BrandBar />); // default profile: display_name "Test User"
  t.truthy(screen.getByText("Test User"));
});

test.serial("does not chop a name at the first space", async (t) => {
  // It used to take the first space-separated word, which renders "Mr. Miyagi"
  // as "Mr." — and does the same to "Van Halen", "Dr. Chen" and any two-word
  // given name. A display name is chosen, not parsed.
  await renderWithAuth(<BrandBar />, { profile: makeProfile({ display_name: "Mr. Miyagi" }) });

  t.truthy(screen.getByText("Mr. Miyagi"));
  t.is(screen.queryByText("Mr."), null);
});

test.serial("shows no name for a signed-out visitor", async (t) => {
  await renderWithAuth(<BrandBar />, { session: null, profile: null });
  t.is(screen.queryByText("Test"), null);
});

test.serial("shows no name pre-onboarding, before display_name is set", async (t) => {
  await renderWithAuth(<BrandBar />, { profile: { id: "11111111-1111-1111-1111-111111111111", display_name: null } });
  t.is(screen.queryByText("Test"), null);
});

test.serial("offers a Log In link for a signed-out visitor, where the name would otherwise be", async (t) => {
  await renderWithAuth(<BrandBar />, { session: null, profile: null });
  const loginLink = screen.getByRole("link", { name: /log in/i });
  t.is(loginLink.getAttribute("href"), "/login");
});

test.serial("the account menu (click the name) offers Settings and Log out", async (t) => {
  const { mock } = await renderWithAuth(<BrandBar />);

  const nameButton = screen.getByRole("button", { name: /account menu for test/i });
  t.is(screen.queryByRole("menu", { name: "Account" }), null);

  fireEvent.click(nameButton);
  t.is(nameButton.getAttribute("aria-expanded"), "true");
  t.is(screen.getByText("Settings").closest("a").getAttribute("href"), "/settings");

  fireEvent.click(screen.getByRole("menuitem", { name: /log out/i }));
  await flush();

  t.deepEqual(mock.authCalls, [{ method: "signOut" }]);
  t.is(screen.queryByRole("menu", { name: "Account" }), null);
});

test.serial("the account menu closes on Escape without logging out", async (t) => {
  const { mock } = await renderWithAuth(<BrandBar />);

  fireEvent.click(screen.getByRole("button", { name: /account menu for test/i }));
  fireEvent.keyDown(document, { key: "Escape" });

  t.is(screen.queryByRole("menu", { name: "Account" }), null);
  t.is(mock.authCalls.length, 0);
});

test.serial("shows no avatar letter beside the name it abbreviates", async (t) => {
  // The letter fallback earns its place in a list, where it identifies someone
  // you cannot otherwise see. Next to the name itself it is a stray character.
  await renderWithAuth(<BrandBar />, {
    profile: makeProfile({ display_name: "Jim B.", avatar_url: null }),
  });

  t.truthy(screen.getByText("Jim B."));
  t.is(screen.queryByText("J"), null);
});

test.serial("shows a real profile picture when there is one", async (t) => {
  await renderWithAuth(<BrandBar />, {
    profile: makeProfile({ display_name: "Jim B.", avatar_url: "u1/pic.jpg" }),
  });

  t.truthy(screen.getByRole("img", { name: /Jim B\..s profile picture/i }));
});

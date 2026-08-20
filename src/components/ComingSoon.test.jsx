import test from "ava";
import { cleanup, renderWithRouter, screen } from "../../test/setup.jsx";
import ComingSoon from "./ComingSoon.jsx";

test.afterEach(() => {
  cleanup();
});

test.serial("renders the title it is given", (t) => {
  renderWithRouter(<ComingSoon title="Notifications" />);
  t.truthy(screen.getByText("Notifications"));
});

test.serial("falls back to a default note", (t) => {
  renderWithRouter(<ComingSoon title="Notifications" />);
  t.truthy(screen.getByText(/isn't wired up to real data yet/i));
});

test.serial("prefers an explicit note over the default", (t) => {
  renderWithRouter(<ComingSoon title="Notifications" note="Landing in the next pass." />);
  t.truthy(screen.getByText("Landing in the next pass."));
  t.is(screen.queryByText(/isn't wired up to real data yet/i), null);
});

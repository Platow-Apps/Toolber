import test from "ava";
import { cleanup, renderWithRouter, screen } from "../../test/setup.jsx";
import PushNudge from "./PushNudge.jsx";

test.afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test.serial("stays silent where the browser cannot do push", async (t) => {
  // jsdom has no PushManager. A standing offer to turn on something that
  // cannot be turned on is worse than no offer.
  renderWithRouter(<PushNudge />);

  t.is(screen.queryByRole("button", { name: "Turn on" }), null);
});

test.serial("stays hidden once it has been dismissed", async (t) => {
  window.localStorage.setItem("toolber:pushNudgeHidden", "1");
  renderWithRouter(<PushNudge />);

  t.is(screen.queryByRole("button", { name: "Turn on" }), null);
});

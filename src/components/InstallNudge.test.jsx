import test from "ava";
import { cleanup, renderWithRouter, screen } from "../../test/setup.jsx";
import InstallNudge from "./InstallNudge.jsx";

test.afterEach.always(() => {
  cleanup();
  window.localStorage.clear();
});

test.serial("stays quiet where there is nothing useful to offer", async (t) => {
  // jsdom is neither iOS nor a browser that fired beforeinstallprompt. A
  // nudge with no button and no instructions is just noise.
  renderWithRouter(<InstallNudge />);

  t.is(screen.queryByText(/Home Screen/i), null);
  t.is(screen.queryByRole("button", { name: "Install" }), null);
});

test.serial("stays hidden once dismissed", async (t) => {
  // Installing is a suggestion, and a suggestion that keeps coming back is
  // an advert.
  window.localStorage.setItem("toolber:installNudgeHidden", "1");
  renderWithRouter(<InstallNudge />);

  t.is(screen.queryByRole("button", { name: "Install" }), null);
});

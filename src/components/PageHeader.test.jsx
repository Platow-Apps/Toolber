import test from "ava";
import { Link, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, renderWithAuth, screen } from "../../test/setup.jsx";
import PageHeader from "./PageHeader.jsx";

test.afterEach(() => {
  cleanup();
});

function app(props = {}) {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div data-testid="home">
            search <Link to="/tool/tool-1">open the saw</Link>
          </div>
        }
      />
      <Route path="/my-tools" element={<div data-testid="my-tools">my tools</div>} />
      <Route path="/tool/:id" element={<PageHeader title="Circular saw" {...props} />} />
    </Routes>
  );
}

// Landing straight on the tool, the way a notification email does it.
const atTool = (props) => renderWithAuth(app(props), { route: "/tool/tool-1" });

test.serial("carries the Toolber wordmark, so an email landing is not a dead end", async (t) => {
  // The whole reason this component exists: Tool Detail used to render a back
  // arrow and nothing else, which is no way into the app for someone who
  // arrived from a notification.
  await atTool();
  t.truthy(screen.getByRole("link", { name: "Toolber" }));
  t.truthy(screen.getByRole("button", { name: /navigation menu/i }));
});

test.serial("shows the title it was given", async (t) => {
  await atTool();
  t.truthy(screen.getByText("Circular saw"));
});

test.serial("Back goes to the fallback when this is the first page in the tab", async (t) => {
  // A mail client opens links in a new tab, where navigate(-1) has no entry to
  // pop and the button silently did nothing.
  await atTool({ backTo: "/my-tools" });
  fireEvent.click(screen.getByRole("button", { name: /go back/i }));
  t.truthy(screen.getByTestId("my-tools"));
});

test.serial("Back still steps backwards when there is history to step through", async (t) => {
  // Arrived by tapping through the app rather than from an email, so Back
  // must behave normally and return to where you came from — not jump to the
  // fallback, which would be a different kind of broken.
  await renderWithAuth(app({ backTo: "/my-tools" }), { route: "/" });
  fireEvent.click(screen.getByRole("link", { name: /open the saw/i }));
  t.truthy(screen.getByText("Circular saw"));

  fireEvent.click(screen.getByRole("button", { name: /go back/i }));
  t.truthy(screen.getByTestId("home"));
});

test.serial("renders an action when given one", async (t) => {
  await atTool({ action: <button type="button">Favorite</button> });
  t.truthy(screen.getByRole("button", { name: "Favorite" }));
});

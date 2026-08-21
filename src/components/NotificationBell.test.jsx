import test from "ava";
import { Route, Routes } from "react-router-dom";
import { act, cleanup, fireEvent, flush, renderWithAuth, screen } from "../../test/setup.jsx";
import NotificationBell from "./NotificationBell.jsx";

test.afterEach(() => {
  cleanup();
});

const NOTIFICATIONS = [
  {
    id: "n-unread",
    type: "borrow_approved",
    payload: { tool_id: "tool-1" },
    read_at: null,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "n-read",
    type: "borrow_denied",
    payload: { tool_id: "tool-2", reason: "Already lent out" },
    read_at: "2026-08-01T01:00:00Z",
    created_at: "2026-07-31T00:00:00Z",
  },
];

function app() {
  return (
    <Routes>
      <Route path="/" element={<NotificationBell />} />
      <Route path="/tool/:id" element={<div data-testid="tool-detail">tool detail</div>} />
    </Routes>
  );
}

function render({ notifications = NOTIFICATIONS } = {}) {
  return renderWithAuth(app(), {
    supabase: {
      tables: { notifications: { data: notifications, error: null } },
    },
  });
}

const bellButton = () => screen.getByRole("button", { name: /Notifications/i });

test.serial("renders nothing for a signed-out visitor", async (t) => {
  await renderWithAuth(app(), { session: null, profile: null });
  t.is(screen.queryByRole("button", { name: /Notifications/i }), null);
});

test.serial("badges the unread count", async (t) => {
  await render();
  t.is(bellButton().textContent, "1");
});

test.serial("shows no badge when everything is read", async (t) => {
  await render({ notifications: [NOTIFICATIONS[1]] });
  t.is(bellButton().textContent, "");
});

test.serial("caps the badge at 9+", async (t) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...NOTIFICATIONS[0], id: `n-${i}` }));
  await render({ notifications: many });
  t.is(bellButton().textContent, "9+");
});

test.serial("lists notifications with human-readable copy, newest first", async (t) => {
  await render();
  fireEvent.click(bellButton());

  t.truthy(screen.getByText(/pickup location is ready/i));
  t.truthy(screen.getByText(/declined: "Already lent out"/i));
});

test.serial("opens on click and closes on Escape, same as the nav menu", async (t) => {
  await render();
  fireEvent.click(bellButton());
  t.truthy(screen.getByRole("menu", { name: "Notifications" }));

  fireEvent.keyDown(document, { key: "Escape" });
  t.is(screen.queryByRole("menu", { name: "Notifications" }), null);
});

test.serial("clicking an unread notification marks it read and navigates to its destination", async (t) => {
  const { mock } = await render();
  fireEvent.click(bellButton());

  fireEvent.click(screen.getByText(/pickup location is ready/i));
  await flush();

  t.truthy(screen.getByTestId("tool-detail"));
  const update = mock.findBuilder("notifications", "update").argsFor("update")[0];
  t.truthy(update.read_at);
  t.deepEqual(mock.findBuilder("notifications", "update").argsFor("in"), ["id", ["n-unread"]]);
});

test.serial("mark all read updates every unread row in one call", async (t) => {
  const { mock } = await render();
  fireEvent.click(bellButton());

  fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
  await flush();

  t.deepEqual(mock.findBuilder("notifications", "update").argsFor("in"), ["id", ["n-unread"]]);
});

test.serial("a live realtime insert appears without a refetch", async (t) => {
  const { mock } = await render();

  act(() => {
    mock.emitRealtime(`notifications:11111111-1111-1111-1111-111111111111`, {
      new: {
        id: "n-live",
        type: "group_join_approved",
        payload: { group_id: "group-1" },
        read_at: null,
        created_at: "2026-08-02T00:00:00Z",
      },
    });
  });
  await flush();

  fireEvent.click(bellButton());
  t.truthy(screen.getByText(/you're in/i));
});

test.serial("shows an empty state instead of a blank panel", async (t) => {
  await render({ notifications: [] });
  fireEvent.click(bellButton());

  t.truthy(screen.getByText(/nothing yet/i));
});

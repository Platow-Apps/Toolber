import test from "ava";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { flush, makeProfile, renderWithAuth } from "../../test/setup.jsx";
import Admin from "./Admin";

test.afterEach.always(cleanup);

const OVERVIEW = [{
  accounts: 42, accounts_active: 40, accounts_complete: 38, accounts_private: 3,
  signups_7d: 5, signups_30d: 12, tools: 96, tools_paused: 4, tools_on_loan: 7,
  groups_total: 6, memberships_approved: 31, requests_pending: 2,
  requests_approved: 9, requests_completed: 55, requests_denied: 3,
  reports_open: 1, feedback_total: 8, searches_30d: 310,
}];

const PEOPLE = [{
  id: "p1", display_name: "Jim B.", email: "jim@example.com",
  created_at: "2026-08-01T00:00:00Z", last_sign_in_at: "2026-09-01T00:00:00Z",
  deleted_at: null, is_platform_admin: false, identity_private: false,
  profile_complete: true, tools_count: 3, borrowed_count: 1, lent_count: 4,
  reports_against: 0,
}];

const DETAIL = [{
  id: "p1", display_name: "Jim B.", email: "jim@example.com", phone: "555-0101",
  home_lat: 38.4404, home_lng: -122.7141, approx_lat: 38.4451, approx_lng: -122.7208,
  pin_radius_meters: 400, default_pickup_location: "142 Birchwood Ct",
  home_address_certified_at: "2026-08-02T00:00:00Z",
  tos_accepted_at: "2026-08-01T00:00:00Z", tos_version: "2026-08-01",
  created_at: "2026-08-01T00:00:00Z", deleted_at: null,
}];

const REPORTS = [{
  id: "r1", reason: "Listed something that is not theirs",
  created_at: "2026-09-01T00:00:00Z", resolved_at: null,
  reporter_id: "p2", reporter_name: "Ana R.",
  reported_id: "p1", reported_name: "Jim B.",
  tool_id: "t1", tool_name: "Chainsaw",
}];

function admin(overrides = {}) {
  return {
    profile: makeProfile({ is_platform_admin: true }),
    supabase: {
      rpcs: {
        admin_overview: { data: OVERVIEW },
        admin_activity: { data: [{ day: "2026-09-01", event_type: "search_performed", n: 5 }] },
        admin_list_users: { data: PEOPLE },
        admin_user_detail: { data: DETAIL },
        admin_list_reports: { data: REPORTS },
        ...overrides,
      },
    },
  };
}

test.serial("an ordinary account is turned away, and asks the server for nothing", async (t) => {
  // The route is behind auth, not behind admin, so this is the case that
  // decides whether the flag means anything on the client at all.
  const { mock } = await renderWithAuth(<Admin />, { profile: makeProfile() });

  t.truthy(screen.getByText(/not available to you/i));
  t.is(mock.rpcCalls.length, 0);
});

test.serial("an admin sees the numbers", async (t) => {
  await renderWithAuth(<Admin />, admin());
  await flush();

  t.truthy(screen.getByText("42")); // accounts
  t.truthy(screen.getByText("96")); // tools listed
  t.truthy(screen.getByText("310")); // searches in the window
});

test.serial("the People tab lists accounts with what each has done", async (t) => {
  await renderWithAuth(<Admin />, admin());
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "People" }));
  // findBy*, not flush: the search box debounces by 250ms and a microtask
  // flush does not advance a timer.
  t.truthy(await screen.findByText("Jim B."));

  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("jim@example.com"));
  t.truthy(screen.getByText(/3 listed · 1 borrowed · 4 lent/));
});

test.serial("opening a record says, on screen, that opening it was logged", async (t) => {
  // The console's whole justification over a column grant is that the look is
  // recorded. An admin who does not know that is not deterred by it.
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByText("Jim B."));
  await flush();

  t.truthy(screen.getByText("555-0101"));
  t.truthy(screen.getByText("142 Birchwood Ct"));
  t.truthy(screen.getByText(/wrote an entry naming you and this account/i));
});

test.serial("a destructive action refuses to fire without the typed word", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByText("Jim B."));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /scrub account/i }));
  await flush();

  t.truthy(screen.getByText(/type scrub to confirm/i));
  t.is(mock.rpcCalls.filter((c) => c.name === "admin_scrub_account").length, 0);
});

test.serial("typing the word sends the scrub, and the reason with it", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, {
    ...admin({ admin_scrub_account: { data: ["p1/one.jpg"] } }),
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByText("Jim B."));
  await flush();

  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Impersonation" } });
  fireEvent.change(screen.getByLabelText(/type the word/i), { target: { value: "scrub" } });
  fireEvent.click(screen.getByRole("button", { name: /scrub account/i }));
  await flush();

  const call = mock.rpcCalls.find((c) => c.name === "admin_scrub_account");
  t.deepEqual(call.args, { p_profile_id: "p1", p_reason: "Impersonation" });
});

test.serial("the word for one action does not fire the other", async (t) => {
  // SCRUB and DELETE are one keystroke apart in consequence: one keeps the
  // row so other people's history still resolves, the other cascades it out.
  const { mock } = await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByText("Jim B."));
  await flush();

  fireEvent.change(screen.getByLabelText(/type the word/i), { target: { value: "SCRUB" } });
  fireEvent.click(screen.getByRole("button", { name: /hard delete/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "admin_hard_delete_account").length, 0);
  t.truthy(screen.getByText(/type delete to confirm/i));
});

test.serial("the reports queue names both sides and can resolve one", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, admin({ admin_resolve_report: { data: null } }));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  await flush();

  t.truthy(screen.getByText(/Jim B\./));
  t.truthy(screen.getByText("Listed something that is not theirs"));

  fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));
  await flush();

  t.deepEqual(
    mock.rpcCalls.find((c) => c.name === "admin_resolve_report").args,
    { p_report_id: "r1", p_resolved: true }
  );
});

test.serial("a refused RPC is shown, not swallowed", async (t) => {
  await renderWithAuth(<Admin />, admin({ admin_overview: { data: null, error: { message: "Not permitted" } } }));
  await flush();

  t.truthy(screen.getByText(/Not permitted/));
});

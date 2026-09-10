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
  t.truthy(await screen.findByRole("button", { name: "Jim B." }));

  t.truthy(screen.getByText("jim@example.com"));
  // Counts are their own cells now rather than one run-on line.
  t.truthy(screen.getByRole("columnheader", { name: "Listed" }));
  t.truthy(screen.getByRole("columnheader", { name: "Borrowed" }));
});

test.serial("opening a record says, on screen, that opening it was logged", async (t) => {
  // The console's whole justification over a column grant is that the look is
  // recorded. An admin who does not know that is not deterred by it.
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("button", { name: "Jim B." }));
  await flush();

  t.truthy(screen.getByText("555-0101"));
  t.truthy(screen.getByText("142 Birchwood Ct"));
  t.truthy(screen.getByText(/wrote an entry naming you and this account/i));
});

test.serial("the record panel is read-only — no way to delete from inside it", async (t) => {
  // Opening a record writes a log line. Keeping the destructive controls out
  // of it means an admin never has to leave that trace merely to act on
  // somebody; the row and the bar above it are enough.
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("button", { name: "Jim B." }));
  await flush();

  t.truthy(screen.getByText("555-0101"));
  t.is(screen.queryByRole("button", { name: /^scrub account$/i }), null);
  t.is(screen.queryByRole("button", { name: /^hard delete$/i }), null);
});

test.serial("the reason is entered on the row and travels with that row's action", async (t) => {
  // Per row rather than once per batch: a batch is rarely one reason, and a
  // single shared box quietly attributes the same sentence to everybody in it.
  const { mock } = await renderWithAuth(<Admin />, {
    ...admin({ admin_scrub_account: { data: ["p1/one.jpg"] } }),
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Jim B." }));

  fireEvent.change(screen.getByLabelText("Reason for Jim B."), { target: { value: "Impersonation" } });
  fireEvent.change(screen.getByLabelText(/confirm word/i), { target: { value: "scrub" } });
  fireEvent.click(screen.getByRole("button", { name: /scrub selected/i }));
  await flush();
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
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Jim B." }));

  fireEvent.change(screen.getByLabelText(/confirm word/i), { target: { value: "SCRUB" } });
  fireEvent.click(screen.getByRole("button", { name: /hard delete selected/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "admin_hard_delete_account").length, 0);
  t.truthy(screen.getByText(/type delete to confirm/i));
});

test.serial("an action with nothing ticked says so rather than doing nothing", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  await screen.findByRole("table");

  fireEvent.change(screen.getByLabelText(/confirm word/i), { target: { value: "SCRUB" } });
  fireEvent.click(screen.getByRole("button", { name: /scrub selected/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "admin_scrub_account").length, 0);
  t.truthy(screen.getByText(/tick at least one account first/i));
});

test.serial("the action bar is present before anything is ticked", async (t) => {
  // Always there rather than appearing on selection: a control that
  // materialises under the cursor is a control that gets clicked by accident.
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  await screen.findByRole("table");

  t.truthy(screen.getByRole("button", { name: /scrub selected/i }));
  t.truthy(screen.getByRole("button", { name: /hard delete selected/i }));
  t.truthy(screen.getByText(/0 selected/));
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

test.serial("the list is a table, and every row can be ticked", async (t) => {
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  await screen.findByRole("table");

  t.truthy(screen.getByRole("columnheader", { name: "Email" }));
  t.truthy(screen.getByRole("checkbox", { name: "Select Jim B." }));
  t.truthy(screen.getByRole("checkbox", { name: "Select all accounts" }));
});

test.serial("ticking one offers the bulk actions, and names who they would hit", async (t) => {
  // A count is not a check. "Scrub 12 accounts" tells an admin nothing about
  // whether the right twelve are ticked.
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Jim B." }));
  await flush();

  t.truthy(screen.getByText(/1 selected/));
  t.truthy(screen.getByText(/Will act on: Jim B\./));
});

test.serial("select-all ticks every row, and clearing unticks them", async (t) => {
  await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select all accounts" }));
  await flush();

  t.true(screen.getByRole("checkbox", { name: "Select Jim B." }).checked);

  fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
  await flush();

  t.false(screen.getByRole("checkbox", { name: "Select Jim B." }).checked);
});

test.serial("a bulk action will not fire without the typed word either", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, admin());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Jim B." }));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /scrub selected/i }));
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "admin_scrub_account").length, 0);
  t.truthy(screen.getByText(/type scrub to confirm/i));
});

test.serial("a bulk scrub sends one call per account, with the reason", async (t) => {
  // One call each rather than a set-based RPC: it reuses the tested
  // single-account path and can report partial failure.
  const { mock } = await renderWithAuth(<Admin />, {
    ...admin({ admin_scrub_account: { data: [] } }),
    supabase: {
      rpcs: {
        ...admin({ admin_scrub_account: { data: [] } }).supabase.rpcs,
        admin_list_users: { data: [PEOPLE[0], { ...PEOPLE[0], id: "p2", display_name: "Ana R.", email: "ana@example.com" }] },
      },
    },
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select all accounts" }));
  await flush();

  fireEvent.change(screen.getByLabelText("Reason for Jim B."), { target: { value: "Spam" } });
  fireEvent.change(screen.getByLabelText(/confirm word/i), { target: { value: "SCRUB" } });
  fireEvent.click(screen.getByRole("button", { name: /scrub selected/i }));
  await flush();
  await flush();

  const calls = mock.rpcCalls.filter((c) => c.name === "admin_scrub_account");
  t.is(calls.length, 2);
  t.deepEqual(calls.map((c) => c.args.p_profile_id).sort(), ["p1", "p2"]);
  // Only the row that was given a reason carries one.
  t.is(calls.find((c) => c.args.p_profile_id === "p1").args.p_reason, "Spam");
  t.is(calls.find((c) => c.args.p_profile_id === "p2").args.p_reason, null);
});

test.serial("one refusal in a batch is reported rather than swallowed", async (t) => {
  const { mock } = await renderWithAuth(<Admin />, {
    ...admin(),
    supabase: {
      rpcs: { ...admin().supabase.rpcs },
      rpc: (name, args) => {
        if (name === "admin_scrub_account") {
          return args.p_profile_id === "p1"
            ? { data: [], error: null }
            : { data: null, error: { message: "Remove the platform admin flag first" } };
        }
        if (name === "admin_overview") return { data: OVERVIEW, error: null };
        if (name === "admin_activity") return { data: [], error: null };
        if (name === "admin_list_users") {
          return {
            data: [PEOPLE[0], { ...PEOPLE[0], id: "p2", display_name: "Ada A.", is_platform_admin: true }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    },
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select all accounts" }));
  await flush();

  fireEvent.change(screen.getByLabelText(/confirm word/i), { target: { value: "SCRUB" } });
  fireEvent.click(screen.getByRole("button", { name: /scrub selected/i }));
  await flush();
  await flush();

  t.is(mock.rpcCalls.filter((c) => c.name === "admin_scrub_account").length, 2);
  t.truthy(screen.getByText(/1 done, 1 refused/i));
  t.truthy(screen.getByText(/Remove the platform admin flag first/));
});

test.serial("the CSV export carries the table's columns and no sensitive ones", async (t) => {
  // The phone number and home coordinates live behind a logged RPC. A
  // spreadsheet of them in a downloads folder is the shape this console was
  // built to avoid, so the export must not quietly acquire them.
  let captured = null;
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:stub";
  const originalBlob = globalThis.Blob;
  globalThis.Blob = class {
    constructor(parts) {
      captured = parts.join("");
    }
  };

  try {
    await renderWithAuth(<Admin />, admin());
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await flush();
  } finally {
    URL.createObjectURL = originalCreate;
    globalThis.Blob = originalBlob;
  }

  t.true(captured.includes("Name,Email"));
  t.true(captured.includes("jim@example.com"));
  t.false(captured.includes("555-0101"));
  t.false(captured.toLowerCase().includes("home"));
});

test.serial("the detail says no home address is stored, rather than showing a blank", async (t) => {
  // Toolber never stores one -- set_my_area() geocodes in the browser and
  // sends only coordinates. An empty row reads as a bug; this reads as a fact.
  await renderWithAuth(<Admin />, {
    ...admin({ admin_user_detail: { data: [{ ...DETAIL[0], default_pickup_location: null }] } }),
  });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "People" }));
  fireEvent.click(await screen.findByRole("button", { name: "Jim B." }));
  await flush();

  t.truthy(screen.getByText(/no home address is ever stored/i));
});

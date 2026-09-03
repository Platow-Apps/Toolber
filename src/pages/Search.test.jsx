import test from "ava";
import { useSearchParams } from "react-router-dom";
import { cleanup, fireEvent, makeProfile, renderWithAuth, screen, waitFor } from "../../test/setup.jsx";
import Search from "./Search.jsx";

test.afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const TOOLS = [
  {
    id: "tool-1",
    name: "Circular saw",
    category: "Cutting",
    description: "7-1/4 in, sharp blade",
    status: "available",
    monetize: false,
    price: null,
    price_duration_unit: null,
    chest_id: "chest-1",
    owner_display_name: "Jim B.",
    owner_approx_lat: 38.48,
    owner_approx_lng: -122.75,
    owner_map_pin_hidden: false,
  },
  {
    id: "tool-2",
    name: "Wet tile saw",
    category: "Cutting",
    description: "For the bathroom job",
    status: "borrowed",
    monetize: true,
    price: 12,
    price_duration_unit: "half_day",
    chest_id: "chest-2",
    owner_display_name: "Ana R.",
    owner_approx_lat: null,
    owner_approx_lng: null,
    owner_map_pin_hidden: true,
  },
];

// Tools come from the search_tools() RPC now (0042) so that Postgres can order
// them by distance before applying the limit; groups are still a plain table
// read.
const render = ({ tools = TOOLS, toolsError = null, groups = [], profile = null, route = "/" } = {}) =>
  renderWithAuth(<Search />, {
    session: profile ? { user: { id: "u1" } } : null,
    profile,
    route,
    supabase: {
      tables: { groups: { data: groups } },
      rpcs: { search_tools: { data: toolsError ? null : tools, error: toolsError } },
    },
  });

/** Args of the most recent search_tools call. */
const lastSearch = (mock) => mock.rpcCalls.filter((c) => c.name === "search_tools").at(-1)?.args;

test.serial("lists the tools it gets back", async (t) => {
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Wet tile saw"));
});

test.serial("shows each tool's owner and status", async (t) => {
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("Available"));
  t.truthy(screen.getByText("Borrowed"));
});

test.serial("prices free tools as Free and paid tools per unit", async (t) => {
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Free"));
  t.truthy(screen.getByText("$12.00/half day"));
});

test.serial("never reads the tools table directly", async (t) => {
  // The central client-side invariant: pickup_location is reachable only
  // through get_pickup_location(). The RPC's return type is a fixed column
  // list that cannot name it, so going through the RPC removes the chance of
  // a select string ever growing one.
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.false(mock.tablesTouched().includes("tools"));
  t.truthy(lastSearch(mock));
});

test.serial("caps the result set rather than fetching every tool", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(lastSearch(mock).p_limit, 60);
});

test.serial("passes the typed query to the search function, trimmed", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.change(screen.getByPlaceholderText(/ladder, drill bits/i), {
    target: { value: "  tile saw  " },
  });

  await waitFor(() => {
    if (lastSearch(mock)?.p_query !== "tile saw") throw new Error("not searched yet");
  });
  t.is(lastSearch(mock).p_query, "tile saw");
});

test.serial("sends no query at all when the box is empty", async (t) => {
  // Null rather than an empty string: the function treats null as "everything"
  // and would otherwise run a pointless empty tsquery.
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(lastSearch(mock).p_query, null);
});

test.serial("searches from nowhere in particular for a signed-out visitor", async (t) => {
  // No profile, no chosen place: results stay newest-first, exactly as before.
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(lastSearch(mock).p_lat, null);
  t.is(lastSearch(mock).p_lng, null);
});

test.serial("measures distance from the signed-in person's own area by default", async (t) => {
  // The whole point of the feature: nearby tools first, with nothing to
  // configure and no permission prompt.
  const { mock } = await render({
    profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }),
  });

  await waitFor(() => {
    if (lastSearch(mock)?.p_lat == null) throw new Error("origin not applied yet");
  });
  t.is(lastSearch(mock).p_lat, 45.677);
  t.is(lastSearch(mock).p_lng, -111.0429);
});

test.serial("shows an empty state when nothing is listed", async (t) => {
  await render({ tools: [] });

  await waitFor(() => screen.getByText(/No tools listed yet/i));
  t.pass();
});

test.serial("surfaces a query error", async (t) => {
  await render({ toolsError: { message: "permission denied for table tools" } });

  await waitFor(() => screen.getByText("permission denied for table tools"));
  t.pass();
});

test.serial("always offers a List entry point next to Browse/Map, even signed out", async (t) => {
  await render();

  const listLink = screen.getByRole("link", { name: /list/i });
  t.is(listLink.getAttribute("href"), "/my-tools/new");
});

test.serial("opens in list view for a first-time visitor", async (t) => {
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  // The map is a ~2MB lazy chunk — brand-new visitors must not pay for it.
  t.is(window.localStorage.getItem("toolber:searchView"), null);
  t.truthy(screen.getByText("Circular saw"));
});

test.serial("remembers a previously-chosen list view across visits", async (t) => {
  window.localStorage.setItem("toolber:searchView", "list");
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Circular saw"));
});

test.serial("links each result through to its detail screen", async (t) => {
  await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(screen.getByText("Circular saw").closest("a").getAttribute("href"), "/tool/tool-1");
});

// NOTE: the map-view branches added in 0031 -- surfacing a query error and
// distinguishing "nothing matched" from a failure -- are deliberately not
// covered here. Switching this screen to map view renders <ToolMap>, which
// imports mapbox-gl's stylesheet, and the AVA loader cannot resolve a .css
// import (the same FE-12 limitation that keeps ToolMap itself untested).
// Those two branches were verified by reading the render path, not by
// executing it. The list-view error path below is covered.

// ── The query survives leaving and coming back (?q=) ────────────────────

test.serial("seeds the search box from the URL", async (t) => {
  // Pressing Back from a tool returns to ?q=saw, and the narrowed set has to
  // still be narrowed — otherwise you lose your place every time you look at
  // a result.
  await render({ route: "/?q=saw" });

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(screen.getByPlaceholderText(/ladder, drill bits/i).value, "saw");
});

test.serial("searches for the seeded term, not for everything", async (t) => {
  const { mock } = await render({ route: "/?q=saw" });

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(lastSearch(mock).p_query, "saw");
});

test.serial("runs an unfiltered search when the URL carries no query", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.is(lastSearch(mock).p_query, null);
});

test.serial("writes the typed query into the URL, so Back can restore it", async (t) => {
  // Seeding from ?q= is only half the fix — something has to put it there.
  // This renders Search alongside a probe sharing the same router context.
  function Harness() {
    const [params] = useSearchParams();
    return (
      <>
        <Search />
        <span data-testid="qs">{params.get("q") ?? ""}</span>
      </>
    );
  }

  renderWithAuth(<Harness />, {
    session: null,
    profile: null,
    route: "/",
    supabase: {
      tables: { groups: { data: [] } },
      rpcs: { search_tools: { data: TOOLS, error: null } },
    },
  });

  await waitFor(() => screen.getByPlaceholderText(/ladder, drill bits/i));
  fireEvent.change(screen.getByPlaceholderText(/ladder, drill bits/i), { target: { value: "drill" } });

  // Debounced, so it lands shortly after typing rather than per keystroke.
  await waitFor(() => {
    if (screen.getByTestId("qs").textContent !== "drill") throw new Error("not yet");
  });
  t.is(screen.getByTestId("qs").textContent, "drill");
});

test.serial("clears q from the URL when the box is emptied", async (t) => {
  function Harness() {
    const [params] = useSearchParams();
    return (
      <>
        <Search />
        <span data-testid="qs">{params.get("q") ?? "(absent)"}</span>
      </>
    );
  }

  renderWithAuth(<Harness />, {
    session: null,
    profile: null,
    route: "/?q=saw",
    supabase: {
      tables: { groups: { data: [] } },
      rpcs: { search_tools: { data: TOOLS, error: null } },
    },
  });

  await waitFor(() => screen.getByPlaceholderText(/ladder, drill bits/i));
  fireEvent.change(screen.getByPlaceholderText(/ladder, drill bits/i), { target: { value: "" } });

  await waitFor(() => {
    if (screen.getByTestId("qs").textContent !== "(absent)") throw new Error("not yet");
  });
  t.is(screen.getByTestId("qs").textContent, "(absent)");
});

test.serial("lists groups, so a group with no map pin is still findable", async (t) => {
  // A group pin is withheld below three members, which used to make a young
  // group invisible everywhere — it was map-only, and it had no pin.
  await render({
    groups: [
      { id: "g1", name: "Rock'n tool chest", neighborhood_label: "Oakhill", city: "Dover", zip_code: "19901", approx_lat: null, approx_lng: null },
    ],
  });

  await waitFor(() => screen.getByText("Rock'n tool chest"));
  t.truthy(screen.getByText(/not on map/i));
});

test.serial("a group with a pin is not labelled as missing one", async (t) => {
  await render({
    groups: [{ id: "g1", name: "Oakhill Tools", neighborhood_label: null, city: "Dover", zip_code: null, approx_lat: 39.15, approx_lng: -75.52 }],
  });

  await waitFor(() => screen.getByText("Oakhill Tools"));
  t.is(screen.queryByText(/not on map/i), null);
});

test.serial("filters groups by zip and neighborhood, not just by name", async (t) => {
  // Someone looking for their own area types the place, not the group's name.
  await render({
    groups: [
      { id: "g1", name: "Rock'n tool chest", neighborhood_label: "Oakhill", city: "Dover", zip_code: "19901", approx_lat: null, approx_lng: null },
      { id: "g2", name: "Elsewhere", neighborhood_label: "Far", city: "Reno", zip_code: "89501", approx_lat: null, approx_lng: null },
    ],
  });

  fireEvent.change(screen.getByPlaceholderText(/ladder, drill bits/i), { target: { value: "19901" } });

  await waitFor(() => screen.getByText("Rock'n tool chest"));
  t.is(screen.queryByText("Elsewhere"), null);
});

test.serial("shows how far away each tool is, so the ordering is legible", async (t) => {
  // A list sorted by something invisible reads as arbitrary.
  await render({
    tools: [{ ...TOOLS[0], distance_miles: 2.4 }],
    profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }),
  });

  await waitFor(() => screen.getByText("Circular saw"));
  t.truthy(screen.getByText("2.4 mi away"));
});

test.serial("offers a way to search somewhere other than where you are", async (t) => {
  // Helping parents move, or checking a rental's neighborhood — the origin is
  // often not the device's location.
  await render({ profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }) });

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.click(screen.getByRole("button", { name: /search near/i }));

  t.truthy(screen.getByRole("dialog", { name: /search near/i }));
  t.truthy(screen.getByLabelText(/address, city, or zip/i));
});

test.serial("says plainly that the origin only reorders, never hides", async (t) => {
  // Search is global by design. Someone setting an origin should not think
  // they have filtered anything out.
  await render({ profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }) });

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.click(screen.getByRole("button", { name: /search near/i }));

  t.truthy(screen.getByText(/only changes the order/i));
  t.truthy(screen.getByText(/every tool stays searchable/i));
});

test.serial("going back to the default location restores an origin, not nothing", async (t) => {
  // This used to clear the stored origin and set the origin to null, which is
  // not what "back to my own area" means to anyone: it switched off proximity
  // ordering entirely and took the map's re-center control with it. The only
  // way back was to grant location permission, which is exactly the prompt the
  // default is meant to avoid.
  window.localStorage.setItem(
    "toolber:searchOrigin",
    JSON.stringify({ lat: 40.76, lng: -111.89, label: "Salt Lake City" })
  );
  const { mock } = await render({
    profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }),
  });

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.click(screen.getByRole("button", { name: /search near/i }));
  fireEvent.click(screen.getByRole("button", { name: /use my default location/i }));

  await waitFor(() => {
    if (lastSearch(mock)?.p_lat !== 45.677) throw new Error("still on the chosen place");
  });
  t.is(lastSearch(mock).p_lat, 45.677);
  t.is(window.localStorage.getItem("toolber:searchOrigin"), null);
});

test.serial("the default location is offered without asking for permission", async (t) => {
  // Nothing here may depend on navigator.geolocation — the point of the row is
  // that it costs no prompt.
  await render({ profile: makeProfile({ approx_lat: 45.677, approx_lng: -111.0429 }) });

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.click(screen.getByRole("button", { name: /search near/i }));

  t.truthy(screen.getByRole("button", { name: /use my default location/i }));
});

test.serial("offers no default location to someone whose profile has no area", async (t) => {
  await render({ profile: makeProfile({ approx_lat: null, approx_lng: null }) });

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.click(screen.getByRole("button", { name: /search near/i }));

  t.is(screen.queryByRole("button", { name: /use my default location/i }), null);
});

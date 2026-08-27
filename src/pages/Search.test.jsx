import test from "ava";
import { cleanup, fireEvent, renderWithAuth, screen, waitFor } from "../../test/setup.jsx";
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
    crib_id: "crib-1",
    profiles: { display_name: "Jim B.", approx_lat: 38.48, approx_lng: -122.75, map_pin_hidden: false },
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
    crib_id: "crib-2",
    profiles: { display_name: "Ana R.", approx_lat: null, approx_lng: null, map_pin_hidden: true },
  },
];

const render = (tables = {}) =>
  renderWithAuth(<Search />, {
    session: null,
    profile: null,
    supabase: { tables: { tools: { data: TOOLS }, groups: { data: [] }, ...tables } },
  });

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

test.serial("never asks the database for pickup_location", async (t) => {
  // The single most important client-side invariant: pickup_location is only
  // reachable through get_pickup_location(). A `select` that named it would be
  // rejected by the column grant, but this catches it before it ships.
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  const columns = mock.builderFor("tools").argsFor("select")[0];
  t.false(columns.includes("pickup_location"));
  t.false(columns.includes("home_lat"));
  t.false(columns.includes("home_lng"));
});

test.serial("caps the result set rather than fetching every tool", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.deepEqual(mock.builderFor("tools").argsFor("limit"), [60]);
});

test.serial("runs a websearch full-text query when the visitor types", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  fireEvent.change(screen.getByPlaceholderText(/ladder, drill bits/i), {
    target: { value: "  tile saw  " },
  });

  await waitFor(() => {
    const searched = mock.fromCalls
      .filter((call) => call.table === "tools")
      .some((call) => call.builder.called("textSearch"));
    if (!searched) throw new Error("no textSearch issued yet");
  });

  const builder = mock.fromCalls
    .filter((call) => call.table === "tools")
    .map((call) => call.builder)
    .find((b) => b.called("textSearch"));
  t.deepEqual(builder.argsFor("textSearch"), ["search_vector", "tile saw", { type: "websearch" }]);
});

test.serial("does not full-text search on an empty query", async (t) => {
  const { mock } = await render();

  await waitFor(() => screen.getByText("Circular saw"));
  t.false(mock.builderFor("tools").called("textSearch"));
});

test.serial("shows an empty state when nothing is listed", async (t) => {
  await render({ tools: { data: [] } });

  await waitFor(() => screen.getByText(/No tools listed yet/i));
  t.pass();
});

test.serial("surfaces a query error", async (t) => {
  await render({ tools: { data: null, error: { message: "permission denied for table tools" } } });

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

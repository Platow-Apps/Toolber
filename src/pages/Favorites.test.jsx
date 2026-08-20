import test from "ava";
import { cleanup, fireEvent, flush, renderPage, screen, TEST_USER_ID } from "../../test/setup.jsx";
import Favorites from "./Favorites.jsx";

test.afterEach(() => {
  cleanup();
});

const FAVORITES = [
  {
    id: "fav-1",
    tool_id: "tool-1",
    tool: {
      id: "tool-1",
      name: "Circular saw",
      status: "available",
      monetize: false,
      price: null,
      price_duration_unit: null,
      profiles: { display_name: "Jim B." },
    },
  },
  {
    id: "fav-2",
    tool_id: "tool-2",
    tool: {
      id: "tool-2",
      name: "Pressure washer",
      status: "borrowed",
      monetize: true,
      price: 20,
      price_duration_unit: "day",
      profiles: { display_name: "Ana R." },
    },
  },
];

const render = (favorites = FAVORITES) =>
  renderPage(<Favorites />, {
    route: "/favorites",
    supabase: { tables: { favorites: { data: favorites } } },
  });

test.serial("lists the saved tools", async (t) => {
  await render();

  t.truthy(screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Pressure washer"));
});

test.serial("scopes the query to the signed-in profile", async (t) => {
  const { mock } = await render();

  t.deepEqual(mock.builderFor("favorites").argsFor("eq"), ["profile_id", TEST_USER_ID]);
});

test.serial("shows each tool's owner, status and price", async (t) => {
  await render();

  t.truthy(screen.getByText("Jim B."));
  t.truthy(screen.getByText("Available"));
  t.truthy(screen.getByText("$20.00/day"));
});

test.serial("links each entry to its tool detail screen", async (t) => {
  await render();

  t.is(screen.getByText("Circular saw").closest("a").getAttribute("href"), "/tool/tool-1");
});

test.serial("shows an empty state with a way back to browsing", async (t) => {
  await render([]);

  t.truthy(screen.getByText(/No favorites yet/i));
  t.is(screen.getByText("Browse tools").getAttribute("href"), "/");
});

test.serial("removes a favorite by its own id and drops it from the list", async (t) => {
  const { mock } = await render();

  fireEvent.click(screen.getByLabelText("Remove Circular saw from favorites"));
  await flush();

  const remover = mock.builderFor("favorites", 1);
  t.true(remover.called("delete"));
  t.deepEqual(remover.argsFor("eq"), ["id", "fav-1"]);
  t.is(screen.queryByText("Circular saw"), null);
  t.truthy(screen.getByText("Pressure washer"));
});

test.serial("skips a favorite whose tool is no longer readable", async (t) => {
  // A deleted (or RLS-hidden) tool comes back as a null join — rendering it
  // would crash the whole list.
  await render([{ id: "fav-3", tool_id: "tool-gone", tool: null }, ...FAVORITES]);

  t.truthy(screen.getByText("Circular saw"));
});

import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  makeProfile,
  MockQueryBuilder,
  renderPage,
  screen,
} from "../../test/setup.jsx";
import Chest from "./Chest.jsx";

test.afterEach(() => {
  cleanup();
});

const OWNER_ID = "owner-1";
const ME = "00000000-0000-0000-0000-00000000000a";

const TOOLS = [
  { id: "t1", name: "Circular saw", category: "Cutting", status: "available", monetize: false, chest_id: OWNER_ID, photos: null },
  { id: "t2", name: "Sawhorses", category: "Support", status: "available", monetize: false, chest_id: OWNER_ID, photos: null },
];

function app() {
  return (
    <Routes>
      <Route path="/chest/:id" element={<Chest />} />
    </Routes>
  );
}

/**
 * The screen reads profiles first (to learn whose chest it is and whether the
 * owner offers it as a collection), then tools. A per-table factory keeps
 * those two independent.
 */
function render({ owner = { id: OWNER_ID, display_name: "Jim B.", chest_public: true }, tools = TOOLS, chestId = OWNER_ID, me = ME } = {}) {
  return renderPage(app(), {
    route: `/chest/${chestId}`,
    profile: makeProfile({ id: me }),
    session: { user: { id: me } },
    supabase: {
      from: (table) => {
        if (table === "profiles") return new MockQueryBuilder({ data: owner, error: null });
        if (table === "tools") return new MockQueryBuilder({ data: tools, error: null });
        return new MockQueryBuilder({ data: null, error: null });
      },
    },
  });
}

test.serial("lists everything the owner lends, in one place", async (t) => {
  await render();

  t.truthy(screen.getByText("Circular saw"));
  t.truthy(screen.getByText("Sawhorses"));
  t.truthy(screen.getByText(/2 tools/i));
});

test.serial("names whose chest it is", async (t) => {
  await render();
  t.truthy(screen.getByText(/Jim B\.'s chest/i));
});

test.serial("publishes no valuation, only a list", async (t) => {
  // A list of what someone lends is useful. A total value of their garage is
  // a target, and it is the one thing this screen must never compute.
  await render();
  t.is(screen.queryByText(/\$/), null);
  t.is(screen.queryByText(/worth/i), null);
});

test.serial("respects an owner who does not offer their tools as a collection", async (t) => {
  await render({ owner: { id: OWNER_ID, display_name: "Jim B.", chest_public: false } });

  t.is(screen.queryByText("Circular saw"), null);
  t.truthy(screen.getByText(/lists tools individually/i));
});

test.serial("is honest that the tools are still findable when the chest is off", async (t) => {
  // The flag is a display preference, not access control. Implying otherwise
  // would be a promise the schema does not keep.
  await render({ owner: { id: OWNER_ID, display_name: "Jim B.", chest_public: false } });

  t.truthy(screen.getByText(/still find them through search/i));
});

test.serial("shows you your own chest whatever the switch says", async (t) => {
  await render({
    owner: { id: ME, display_name: "Me", chest_public: false },
    chestId: ME,
  });

  t.truthy(screen.getByText("Circular saw"));
  t.truthy(screen.getByText(/my chest/i));
});

test.serial("says so plainly when there is nothing listed", async (t) => {
  await render({ tools: [] });
  t.truthy(screen.getByText(/nothing listed right now/i));
});

test.serial("leaves out paused listings, as search does", async (t) => {
  const { mock } = await render();

  const builder = mock.builderFor("tools");
  t.deepEqual(builder.argsFor("eq"), ["chest_id", OWNER_ID]);
  t.true(builder.calls.some((c) => c.method === "eq" && c.args[0] === "paused" && c.args[1] === false));
});

test.serial("reminds a borrower that each tool is its own request", async (t) => {
  // Seeing a collection invites "can I take these three", which is not how
  // approval works — every tool is approved separately by its owner.
  await render();
  t.truthy(screen.getByText(/approving one doesn't approve the rest/i));
});

test.serial("logs a chest_viewed event", async (t) => {
  const { mock } = await render();
  t.deepEqual(mock.eventLogged("chest_viewed")?.metadata, { chest_id: OWNER_ID });
});

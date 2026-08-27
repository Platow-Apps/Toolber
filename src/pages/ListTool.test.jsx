import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  flush,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import ListTool from "./ListTool.jsx";

test.afterEach(() => {
  cleanup();
});

function app() {
  return (
    <Routes>
      <Route path="/my-tools/new" element={<ListTool />} />
      <Route path="/my-tools/:id/edit" element={<ListTool />} />
      <Route path="/my-tools" element={<div data-testid="my-tools">my tools</div>} />
    </Routes>
  );
}

function render({ insert = { data: { id: "tool-new" }, error: null }, storage } = {}) {
  return renderPage(app(), {
    route: "/my-tools/new",
    supabase: {
      from: (table) =>
        table === "tools"
          ? new MockQueryBuilder(insert)
          : new MockQueryBuilder({ data: null, error: null }),
      storage,
    },
  });
}

function fillRequired({ name = "Wet tile saw", description = "Fresh blade", pickup = "  142 Birchwood Ct  " } = {}) {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText(/Condition, what it's good for/i), {
    target: { value: description },
  });
  fireEvent.change(screen.getByPlaceholderText(/142 Birchwood Ct/i), { target: { value: pickup } });
}

const submitButton = () => screen.getByRole("button", { name: /list this tool/i });

test.serial("keeps submit disabled until name, description and pickup are filled", async (t) => {
  await render();

  t.true(submitButton().disabled);

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: "Ladder" } });
  t.true(submitButton().disabled);

  fillRequired({ name: "Ladder" });
  t.false(submitButton().disabled);
});

test.serial("requires a price once the tool is monetized", async (t) => {
  await render();
  fillRequired();

  fireEvent.click(screen.getByText("Rent out?").parentElement.querySelector("input"));
  t.true(submitButton().disabled);

  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "12" } });
  t.false(submitButton().disabled);
});

test.serial("open to sell doesn't require an asking price to submit", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(screen.getByText("Open to sell?").parentElement.querySelector("input"));
  t.false(submitButton().disabled);

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.for_sale, true);
  t.is(row.asking_price, null);
});

test.serial("stores for_sale/asking_price as null when not open to sell", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.for_sale, false);
  t.is(row.asking_price, null);
});

test.serial("stores the asking price as a number when open to sell", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(screen.getByText("Open to sell?").parentElement.querySelector("input"));
  fireEvent.change(screen.getByLabelText(/asking price/i), { target: { value: "75.50" } });
  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.for_sale, true);
  t.is(row.asking_price, 75.5);
});

test.serial("trims whitespace off the pickup location before saving it", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.builderFor("tools").argsFor("insert")[0].pickup_location, "142 Birchwood Ct");
});

test.serial("saves the tool against the signed-in user's chest", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.chest_id, TEST_USER_ID);
  t.is(row.name, "Wet tile saw");
  t.is(row.kind, "single");
  t.is(row.portable, true);
});

test.serial("never claims supervision is required for a portable tool", async (t) => {
  // The supervision toggle only exists for stationary tools; a stale `true`
  // from switching back to Portable must not survive into the insert.
  const { mock } = await render();
  fillRequired();

  fireEvent.click(screen.getByRole("button", { name: "Stationary" }));
  fireEvent.click(screen.getByText("Requires supervision").parentElement.querySelector("input"));
  fireEvent.click(screen.getByRole("button", { name: "Portable" }));
  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.portable, true);
  t.is(row.supervised_required, false);
});

test.serial("keeps supervision when the tool really is stationary", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(screen.getByRole("button", { name: "Stationary" }));
  fireEvent.click(screen.getByText("Requires supervision").parentElement.querySelector("input"));
  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.portable, false);
  t.is(row.supervised_required, true);
});

test.serial("stores no price at all for a free tool", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.monetize, false);
  t.is(row.price, null);
  t.is(row.price_duration_unit, null);
});

test.serial("stores price as a number, not the raw input string", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(screen.getByText("Rent out?").parentElement.querySelector("input"));
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "12.50" } });
  fireEvent.click(submitButton());
  await flush();

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.is(row.price, 12.5);
  t.is(row.price_duration_unit, "day");
});

test.serial("offers the hourly rate added in migration 0003", async (t) => {
  await render();
  fillRequired();
  fireEvent.click(screen.getByText("Rent out?").parentElement.querySelector("input"));

  t.truthy(screen.getByRole("option", { name: "per hour" }));
});

test.serial("logs a tool_listed event", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.deepEqual(mock.eventLogged("tool_listed"), {
    profile_id: TEST_USER_ID,
    event_type: "tool_listed",
    metadata: { tool_id: "tool-new" },
  });
});

test.serial("returns to My Tools after a successful listing", async (t) => {
  await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByTestId("my-tools"));
});

test.serial("stays on the form and shows the error when the insert fails", async (t) => {
  await render({ insert: { data: null, error: { message: "new row violates row-level security policy" } } });
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText("new row violates row-level security policy"));
  t.is(screen.queryByTestId("my-tools"), null);
});

test.serial("stores an empty category as null rather than an empty string", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.builderFor("tools").argsFor("insert")[0].category, null);
});

function fileInput() {
  return document.querySelector('input[type="file"]');
}

function makeFile(name = "ladder.jpg", type = "image/jpeg") {
  return new File(["fake-bytes"], name, { type });
}

test.serial("lets you add up to 3 photos and remove one before submitting", async (t) => {
  await render();

  fireEvent.change(fileInput(), { target: { files: [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg"), makeFile("d.jpg")] } });

  const thumbnails = screen.getAllByAltText(/Preview/i);
  t.is(thumbnails.length, 3); // the 4th is dropped, at the MAX_PHOTOS cap
  t.is(fileInput(), null); // no room left, so the picker itself is gone

  fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
  t.is(screen.getAllByAltText(/Preview/i).length, 2);
  t.truthy(fileInput()); // room again
});

test.serial("uploads photos before creating the tool and saves the returned paths", async (t) => {
  const uploadCalls = [];
  const { mock } = await render({
    storage: (bucket) => ({
      upload(path, file) {
        uploadCalls.push({ bucket, path, fileName: file.name });
        return Promise.resolve({ data: { path }, error: null });
      },
    }),
  });
  fillRequired();

  fireEvent.change(fileInput(), { target: { files: [makeFile("ladder.jpg")] } });
  fireEvent.click(submitButton());
  await flush();

  t.is(uploadCalls.length, 1);
  t.is(uploadCalls[0].bucket, "tool-photos");
  t.is(uploadCalls[0].fileName, "ladder.jpg");
  t.regex(uploadCalls[0].path, new RegExp(`^${TEST_USER_ID}/.+\\.jpg$`));

  const row = mock.builderFor("tools").argsFor("insert")[0];
  t.deepEqual(row.photos, [uploadCalls[0].path]);
});

// ─── Edit mode ───────────────────────────────────────────────────────

const EXISTING = {
  id: "tool-9",
  chest_id: TEST_USER_ID,
  name: "Old ladder",
  category: "ladders",
  description: "8ft fibreglass",
  kind: "single",
  portable: true,
  supervised_required: false,
  monetize: true,
  price: 9,
  price_duration_unit: "day",
  for_sale: true,
  photos: ["chest/keep.jpg", "chest/drop.jpg"],
};

function renderEdit({ tool = EXISTING, pickup = "12 Elm St", asking = 250, storage } = {}) {
  return renderPage(app(), {
    route: "/my-tools/tool-9/edit",
    supabase: {
      from: (table) =>
        table === "tools"
          ? new MockQueryBuilder({ data: tool, error: null })
          : new MockQueryBuilder({ data: null, error: null }),
      // A pickup location is required to submit, so edit-mode tests that go on
      // to save must resolve this RPC with a real value, not null.
      rpc: (name) =>
        name === "get_pickup_location"
          ? { data: pickup, error: null }
          : name === "get_asking_price"
            ? { data: asking, error: null }
            : { data: null, error: null },
      storage,
    },
  });
}

test.serial("prefills every field, pulling the two protected values via their RPCs", async (t) => {
  await renderEdit();
  await flush();

  t.is(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i).value, "Old ladder");
  t.is(screen.getByPlaceholderText(/Condition, what it's good for/i).value, "8ft fibreglass");
  t.is(screen.getByPlaceholderText(/142 Birchwood Ct/i).value, "12 Elm St");
  t.is(screen.getByLabelText("Rental price").value, "9");
  t.is(screen.getByLabelText(/asking price/i).value, "250");
  t.is(screen.getAllByAltText(/Preview/i).length, 2);
});

test.serial("saves an edit as an update to that row, never a second insert", async (t) => {
  const { mock } = await renderEdit();
  await flush();

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: "Newer ladder" } });
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await flush();

  const builder = mock.findBuilder("tools", "update");
  t.is(builder.argsFor("update")[0].name, "Newer ladder");
  t.deepEqual(builder.argsFor("eq"), ["id", "tool-9"]);
  t.is(mock.findBuilder("tools", "insert"), undefined);
  t.truthy(screen.getByTestId("my-tools"));
});

function storageSpy({ uploads = [], removed = [] } = {}) {
  return () => ({
    upload(path) {
      uploads.push(path);
      return Promise.resolve({ data: { path }, error: null });
    },
    remove(paths) {
      removed.push(...paths);
      return Promise.resolve({ data: [], error: null });
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://example.test/${path}` } }),
  });
}

test.serial("keeps untouched photos by path rather than re-uploading them", async (t) => {
  const uploads = [];
  const { mock } = await renderEdit({ storage: storageSpy({ uploads }) });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await flush();

  t.is(uploads.length, 0);
  t.deepEqual(mock.findBuilder("tools", "update").argsFor("update")[0].photos, [
    "chest/keep.jpg",
    "chest/drop.jpg",
  ]);
});

test.serial("removing a stored photo drops it from the row and deletes it from storage", async (t) => {
  const removed = [];
  const { mock } = await renderEdit({ storage: storageSpy({ removed }) });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await flush();

  t.deepEqual(mock.findBuilder("tools", "update").argsFor("update")[0].photos, ["chest/keep.jpg"]);
  t.deepEqual(removed, ["chest/drop.jpg"]);
});

test.serial("refuses to edit a tool belonging to someone else", async (t) => {
  await renderEdit({ tool: { ...EXISTING, chest_id: "someone-else" } });
  await flush();

  t.truthy(screen.getByText(/isn't your tool to edit/i));
});

test.serial("surfaces an upload failure instead of creating the tool without that photo", async (t) => {
  const { mock } = await render({
    storage: () => ({
      upload() {
        return Promise.resolve({ data: null, error: { message: "Storage quota exceeded" } });
      },
    }),
  });
  fillRequired();

  fireEvent.change(fileInput(), { target: { files: [makeFile()] } });
  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText("Storage quota exceeded"));
  t.false(mock.tablesTouched().includes("tools"));
});

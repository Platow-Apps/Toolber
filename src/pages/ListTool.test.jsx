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

test.afterEach.always(() => {
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

/**
 * Saving looks for a near-duplicate first, through find_similar_tools (0049) —
 * fuzzy on the name, exact on photo hashes. `existing` is what that RPC finds;
 * the default is "nothing like this listed".
 */
function render({ insert = { data: { id: "tool-new" }, error: null }, existing = [], storage } = {}) {
  return renderPage(app(), {
    route: "/my-tools/new",
    supabase: {
      from: (table) =>
        table === "tools"
          ? new MockQueryBuilder(insert)
          : new MockQueryBuilder({ data: null, error: null }),
      rpc: (name) => (name === "find_similar_tools" ? { data: existing, error: null } : { data: null, error: null }),
      storage,
    },
  });
}

function pickCategory(query = "air compressors") {
  const box = screen.getByPlaceholderText(/search e\.g\./i);
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: query } });
  fireEvent.click(screen.getAllByRole("option")[0]);
}

function fillRequired({ name = "Wet tile saw", pickup = "  142 Birchwood Ct  ", condition = "Good" } = {}) {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText(/142 Birchwood Ct/i), { target: { value: pickup } });
  pickCategory();
  fireEvent.click(screen.getByRole("button", { name: condition }));
}

const submitButton = () => screen.getByRole("button", { name: /list this tool/i });

test.serial("keeps submit disabled until every required field is filled", async (t) => {
  await render();

  t.true(submitButton().disabled);

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: "Ladder" } });
  t.true(submitButton().disabled);

  fireEvent.change(screen.getByPlaceholderText(/142 Birchwood Ct/i), { target: { value: "1 Elm" } });
  t.true(submitButton().disabled, "still needs a category and a condition");

  pickCategory();
  t.true(submitButton().disabled, "still needs a condition");

  fireEvent.click(screen.getByRole("button", { name: "Good" }));
  t.false(submitButton().disabled);
});

test.serial("stores the category and subcategory as separate columns", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.category, "Air & Compressed Air");
  t.is(row.subcategory, "Air compressors");
});

test.serial("stores the chosen condition and an optional brand", async (t) => {
  const { mock } = await render();
  fillRequired({ condition: "Fair" });
  fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "  Ridgid  " } });

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.condition, "fair");
  t.is(row.brand, "Ridgid");
});

test.serial("stores a blank brand as null rather than an empty string", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.findBuilder("tools", "insert").argsFor("insert")[0].brand, null);
});

test.serial("no longer asks for a free-text description", async (t) => {
  // Replaced by condition/brand/subcategory in 0026 — the column still exists
  // for legacy rows, but nothing should be writing it from here.
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.false("description" in mock.findBuilder("tools", "insert").argsFor("insert")[0]);
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

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.for_sale, true);
  t.is(row.asking_price, null);
});

test.serial("stores for_sale/asking_price as null when not open to sell", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
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

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.for_sale, true);
  t.is(row.asking_price, 75.5);
});

test.serial("trims whitespace off the pickup location before saving it", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.findBuilder("tools", "insert").argsFor("insert")[0].pickup_location, "142 Birchwood Ct");
});

test.serial("saves the tool against the signed-in user's chest", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
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

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
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

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.portable, false);
  t.is(row.supervised_required, true);
});

test.serial("stores no price at all for a free tool", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
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

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
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

test.serial("stores a bare top-level category with a null subcategory", async (t) => {
  // Category is required now, but picking only the parent is still valid —
  // that must land as null, not an empty string.
  const { mock } = await render();
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), { target: { value: "Ladder" } });
  fireEvent.change(screen.getByPlaceholderText(/142 Birchwood Ct/i), { target: { value: "1 Elm" } });
  pickCategory("Automotive");
  fireEvent.click(screen.getByRole("button", { name: "Good" }));

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.category, "Automotive");
  t.is(row.subcategory, null);
});

function fileInput() {
  return document.querySelector('input[type="file"]');
}

// Content varies by name. Photos are de-duplicated by content hash, so
// fixtures that all shared the same bytes would be collapsed into one — which
// is correct behaviour against an unrealistic fixture, since two different
// photographs never have identical bytes.
function makeFile(name = "ladder.jpg", type = "image/jpeg") {
  return new File([`fake-bytes-${name}`], name, { type });
}

test.serial("lets you add up to 3 photos and remove one before submitting", async (t) => {
  await render();

  fireEvent.change(fileInput(), { target: { files: [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg"), makeFile("d.jpg")] } });

  await flush();

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

  await flush();
  fireEvent.click(submitButton());
  await flush();

  t.is(uploadCalls.length, 1);
  t.is(uploadCalls[0].bucket, "tool-photos");
  t.is(uploadCalls[0].fileName, "ladder.jpg");
  t.regex(uploadCalls[0].path, new RegExp(`^${TEST_USER_ID}/.+\\.jpg$`));

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.deepEqual(row.photos, [uploadCalls[0].path]);
});

// ─── Edit mode ───────────────────────────────────────────────────────

const EXISTING = {
  id: "tool-9",
  chest_id: TEST_USER_ID,
  name: "Old ladder",
  category: "ladders",
  subcategory: "Ladders & scaffolding",
  condition: "good",
  brand: "Werner",
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
  // The thumbnail goes with it, or it would sit in the bucket forever with
  // nothing referencing it.
  t.deepEqual(removed, ["chest/drop.jpg", "chest/drop.thumb.jpg"]);
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

  await flush();
  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText("Storage quota exceeded"));
  // No row was created. Not "tools was never touched" any more: a new
  // listing reads the table first, to check for one of the same name.
  t.is(mock.findBuilder("tools", "insert"), undefined);
});

// ── Specs (0029) ────────────────────────────────────────────────────────

function fillSpec(index, label, value) {
  fireEvent.change(screen.getByLabelText(`Spec ${index} name`), { target: { value: label } });
  fireEvent.change(screen.getByLabelText(`Spec ${index} value`), { target: { value } });
}

test.serial("stores the filled spec rows as label/value pairs", async (t) => {
  const { mock } = await render();
  fillRequired();
  fillSpec(1, "Voltage", "18V");
  fillSpec(3, "Size", "7-1/4 in");

  fireEvent.click(submitButton());
  await flush();

  t.deepEqual(mock.findBuilder("tools", "insert").argsFor("insert")[0].specs, [
    { label: "Voltage", value: "18V" },
    { label: "Size", value: "7-1/4 in" },
  ]);
});

test.serial("stores null, not empty rows, when no specs are entered", async (t) => {
  const { mock } = await render();
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.findBuilder("tools", "insert").argsFor("insert")[0].specs, null);
});

test.serial("skips a spec row with only one half filled in", async (t) => {
  const { mock } = await render();
  fillRequired();
  fireEvent.change(screen.getByLabelText("Spec 1 name"), { target: { value: "Voltage" } });

  fireEvent.click(submitButton());
  await flush();

  t.is(mock.findBuilder("tools", "insert").argsFor("insert")[0].specs, null);
});

test.serial("prefills stored specs when editing", async (t) => {
  await renderEdit({
    tool: { ...EXISTING, specs: [{ label: "Height", value: "8 ft" }] },
  });
  await flush();

  t.is(screen.getByLabelText("Spec 1 name").value, "Height");
  t.is(screen.getByLabelText("Spec 1 value").value, "8 ft");
  t.is(screen.getByLabelText("Spec 2 name").value, "", "remaining slots stay blank");
});

test.serial("offers the saved default location instead of retyping it", async (t) => {
  // Most people lend every tool from the same place, so the second listing
  // onwards was retyping an address the app already had.
  await renderPage(<ListTool />, {
    route: "/my-tools/new",
    supabase: { rpc: (name) => (name === "get_my_default_pickup" ? { data: "142 Birchwood Ct", error: null } : { data: null, error: null }) },
  });
  await flush();

  fireEvent.click(screen.getByLabelText(/Use my default location/i));

  t.is(screen.getByLabelText(/Pickup location/i).value, "142 Birchwood Ct");
});

test.serial("offers nothing when no address has been saved", async (t) => {
  // Saving one is opt-in, and the default is still to keep no address at all.
  await renderPage(<ListTool />, { route: "/my-tools/new" });
  await flush();

  t.is(screen.queryByLabelText(/Use my default location/i), null);
});

test.serial("unticks itself when the address is edited by hand", async (t) => {
  // Derived from the field rather than tracked separately, so the box can
  // never claim a listing is on the default location when it isn't.
  await renderPage(<ListTool />, {
    route: "/my-tools/new",
    supabase: { rpc: (name) => (name === "get_my_default_pickup" ? { data: "142 Birchwood Ct", error: null } : { data: null, error: null }) },
  });
  await flush();

  const box = screen.getByLabelText(/Use my default location/i);
  fireEvent.click(box);
  t.true(box.checked);

  fireEvent.change(screen.getByLabelText(/Pickup location/i), { target: { value: "The library car park" } });
  t.false(box.checked);
});

test.serial("offers a rotate control on every photo", async (t) => {
  // A phone getting the orientation wrong is the commonest thing wrong with
  // an uploaded photo, and it is only fixable while you can see the picture.
  await render();

  fireEvent.change(fileInput(), { target: { files: [makeFile("saw.jpg")] } });

  await flush();

  t.truthy(screen.getByRole("button", { name: /Rotate photo 1 a quarter turn/i }));
});

test.serial("keeps the photo when the browser cannot rotate it", async (t) => {
  // jsdom cannot decode an image, which is the same shape as a browser that
  // fails partway. A rotation that could not happen must not lose the photo.
  await render();

  fireEvent.change(fileInput(), { target: { files: [makeFile("saw.jpg")] } });

  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Rotate photo 1 a quarter turn/i }));
  await flush();

  t.truthy(screen.getByRole("button", { name: /Remove photo 1/i }));
});

test.serial("does not add the same photo twice", async (t) => {
  // Compared by content, not name: a photo re-picked from a phone's gallery
  // often arrives renamed.
  await render();

  fireEvent.change(fileInput(), { target: { files: [makeFile("saw.jpg")] } });
  await flush();
  fireEvent.change(fileInput(), {
    target: { files: [new File(["fake-bytes-saw.jpg"], "IMG_4821.jpg", { type: "image/jpeg" })] },
  });
  await flush();

  t.is(screen.getAllByAltText(/Preview/i).length, 1);
  t.truthy(screen.getByText(/already added/i));
});

test.serial("warns about a same-named listing instead of silently making a second", async (t) => {
  // A double submit and a genuine second drill look identical from here, so
  // this asks rather than deciding.
  await render({ existing: [{ id: "tool-1", name: "Wet tile saw" }] });
  fillRequired();

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText(/already listed — is this a duplicate\?/i));
  t.is(screen.getByRole("button", { name: "List it anyway" }).disabled, false);
});

test.serial("lists it anyway when the owner says so", async (t) => {
  // Owning two of the same tool is perfectly ordinary — this is a warning,
  // not a constraint.
  const { mock } = await render({ existing: [{ id: "tool-1", name: "Wet tile saw" }] });
  fillRequired();

  fireEvent.click(submitButton());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "List it anyway" }));
  await flush();

  t.truthy(mock.findBuilder("tools", "insert"));
});

test.serial("catches a near-name, not just an exact one", async (t) => {
  // "Heater Gun" and "Heat Gun" are the same heat gun. The exact-match check
  // this replaced said nothing about either.
  const { mock } = await render({
    existing: [{ id: "tool-1", name: "Heat Gun", matched_photo: false, name_similarity: 0.67 }],
  });
  fillRequired({ name: "Heater Gun" });

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText(/Heat Gun/));
  t.truthy(screen.getByText(/already listed — is this a duplicate/i));
  t.is(mock.findBuilder("tools", "insert"), undefined);
});

test.serial("says when the photo is the giveaway rather than the name", async (t) => {
  // A shared photograph is a much stronger claim than any name score, and it
  // survives someone renaming the tool entirely.
  await render({
    existing: [{ id: "tool-1", name: "Paint Stripper", matched_photo: true, name_similarity: 0.1 }],
  });
  fillRequired({ name: "Heat Gun" });

  fireEvent.click(submitButton());
  await flush();

  t.truthy(screen.getByText(/uses the same photo/i));
});

test.serial("sends the name, the photo hashes and nothing to exclude on a new listing", async (t) => {
  const { mock } = await render();
  fillRequired({ name: "Heat Gun" });

  fireEvent.click(submitButton());
  await flush();

  const call = mock.rpcCalls.find((c) => c.name === "find_similar_tools");
  t.is(call.args.p_name, "Heat Gun");
  t.deepEqual(call.args.p_photo_hashes, []);
  t.is(call.args.p_exclude_tool_id, null);
});

test.serial("stores a hash alongside each photo it saves", async (t) => {
  // Positional with photos, so a row's hashes always describe its own images.
  const { mock } = await render();
  fillRequired();
  fireEvent.change(fileInput(), { target: { files: [makeFile("saw.jpg")] } });
  await flush();

  fireEvent.click(submitButton());
  await flush();

  const row = mock.findBuilder("tools", "insert").argsFor("insert")[0];
  t.is(row.photo_hashes.length, row.photos.length);
});

test.serial("suggests a category from the tool's name", async (t) => {
  // A tool's name usually is its category, so making someone hunt through
  // several hundred subcategories to say what they just typed is the app
  // asking them to do its arithmetic.
  await render();

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), {
    target: { value: "Heat gun" },
  });

  t.truthy(screen.getByText(/Looks like/i));
  t.truthy(screen.getByText("Power Tools"));
});

test.serial("suggests nothing when the name gives nothing away", async (t) => {
  // A wrong suggestion is worse than none, because it gets accepted.
  await render();

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), {
    target: { value: "Whatsit" },
  });

  t.is(screen.queryByText(/Looks like/i), null);
});

test.serial("the suggestion is offered, never applied", async (t) => {
  // It is a string match and is wrong often enough that accepting it has to
  // be a decision.
  const { mock } = await render();

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), {
    target: { value: "Heat gun" },
  });
  fillRequired({ name: "Heat gun" });
  fireEvent.click(submitButton());
  await flush();

  // fillRequired picks a category itself, so the suggestion never ran — what
  // matters is that nothing was written without a tap.
  t.truthy(mock.findBuilder("tools", "insert"));
});

test.serial("tapping the suggestion fills the category in", async (t) => {
  await render();

  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Wet tile saw/i), {
    target: { value: "Heat gun" },
  });
  fireEvent.click(screen.getByText(/Looks like/i).closest("button"));

  // Once taken, it stops offering — it must never argue with a choice made.
  t.is(screen.queryByText(/Looks like/i), null);
});

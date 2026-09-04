import test from "ava";
import { Route, Routes } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  flush,
  makeProfile,
  MockQueryBuilder,
  renderPage,
  screen,
  TEST_USER_ID,
} from "../../test/setup.jsx";
import Onboarding from "./Onboarding.jsx";

test.afterEach(() => {
  cleanup();
  delete globalThis.fetch;
});

function app() {
  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/" element={<div data-testid="home">search screen</div>} />
    </Routes>
  );
}

/** Install a Mapbox geocoding stub, shaped like the real response, for one test. */
function stubGeocode({ lat, lng, ok = true, found = true } = {}) {
  globalThis.fetch = async () => ({
    ok,
    json: async () => ({ features: found ? [{ center: [lng, lat] }] : [] }),
  });
}

function render({ update = { data: null, error: null } } = {}) {
  return renderPage(app(), {
    route: "/onboarding",
    profile: makeProfile({ profile_complete: false, display_name: null }),
    supabase: {
      from: () => new MockQueryBuilder(update),
    },
  });
}

const nameField = () => screen.getByPlaceholderText(/Jordan K\./i);
// The address is four separate fields now (street / apt / city / state /
// ZIP), so the geocoder gets city and state instead of whatever the person
// happened to type on one line.
const streetField = () => screen.getByLabelText("Street address");
const cityField = () => screen.getByLabelText("City");
const stateField = () => screen.getByLabelText("State");
const zipField = () => screen.getByLabelText("ZIP code");
const continueButton = () => screen.getByRole("button", { name: /continue/i });
const showOnMapCheckbox = () => screen.getByLabelText(/show my approximate location/i);
const tosCheckbox = () => screen.getByLabelText(/agree to the terms/i);

function fillRequiredFields({ name = "Jordan K.", street = "142 Birchwood Ct", city = "Springfield", state = "CA", zip = "95403" } = {}) {
  fireEvent.change(nameField(), { target: { value: name } });
  fireEvent.change(streetField(), { target: { value: street } });
  fireEvent.change(cityField(), { target: { value: city } });
  fireEvent.change(stateField(), { target: { value: state } });
  fireEvent.change(zipField(), { target: { value: zip } });
  fireEvent.click(tosCheckbox());
}

test.serial("blocks continuing until name, address and ToS are all set", async (t) => {
  await render();

  t.true(continueButton().disabled);

  fireEvent.change(nameField(), { target: { value: "Jordan K." } });
  t.true(continueButton().disabled);

  fireEvent.change(streetField(), { target: { value: "142 Birchwood Ct" } });
  t.true(continueButton().disabled, "a street line alone is what the geocoder chokes on");

  fireEvent.change(cityField(), { target: { value: "Springfield" } });
  fireEvent.change(stateField(), { target: { value: "CA" } });
  t.true(continueButton().disabled, "still needs the terms accepted");

  fireEvent.click(tosCheckbox());
  t.false(continueButton().disabled);
});

test.serial("records ToS acceptance with a version and a timestamp", async (t) => {
  // The ToS acceptance record is the app's only risk acknowledgement — there is
  // deliberately no per-tool competency checkbox.
  stubGeocode({ lat: 38.4404, lng: -122.7141 });
  const { mock } = await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.truthy(update.tos_accepted_at);
  t.truthy(update.tos_version);
  t.is(update.profile_complete, true);
  t.is(update.display_name, "Jordan K.");
});

test.serial("geocodes the typed address and hands the point to the server to fuzz", async (t) => {
  // The privacy-critical part of the location model. The jitter used to be
  // computed here, in the browser, and is now done in Postgres (0045) -- so
  // what this asserts is that the client sends the *real* point and no
  // approximate one, because deriving the public pin is not its job and a
  // client that got it wrong would publish someone's front door.
  stubGeocode({ lat: 38.4404, lng: -122.7141 });

  const { mock } = await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  const call = mock.rpcCalls.find((c) => c.name === "set_my_area");
  t.truthy(call, "onboarding should set the area through the RPC");
  t.is(call.args.p_lat, 38.4404);
  t.is(call.args.p_lng, -122.7141);
  t.is(call.args.p_radius_meters, 800);

  // And no coordinate is written straight to the row any more.
  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.is(update.home_lat, undefined);
  t.is(update.approx_lat, undefined);
  t.is(update.map_pin_hidden, false);
});

test.serial("does not mark the profile complete when the area could not be saved", async (t) => {
  // The other order would leave someone complete with no area, and nothing in
  // the app asks a second time.
  stubGeocode({ lat: 38.4404, lng: -122.7141 });

  const { mock } = await renderPage(app(), {
    route: "/onboarding",
    profile: makeProfile({ profile_complete: false, display_name: null }),
    supabase: {
      from: () => new MockQueryBuilder({ data: null, error: null }),
      rpc: () => ({ data: null, error: { message: "The pin radius must be between 200 and 5000 meters." } }),
    },
  });
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.is(mock.findBuilder("profiles", "update"), undefined);
  t.truthy(screen.getByText(/pin radius must be between/i));
});

test.serial("keeps the pin off the map without skipping location capture", async (t) => {
  // Every profile still gets a real point on file (needed for e.g. Find a
  // Group proximity) -- "hide" now only controls map visibility, not
  // whether a location exists at all.
  stubGeocode({ lat: 38.4404, lng: -122.7141 });

  const { mock } = await render();
  fillRequiredFields();
  fireEvent.click(showOnMapCheckbox());

  fireEvent.click(continueButton());
  await flush();

  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.is(update.map_pin_hidden, true);
  // A point is still captured either way -- "hide" controls map visibility,
  // not whether a location exists at all (Find a Group needs one regardless).
  t.truthy(mock.rpcCalls.find((c) => c.name === "set_my_area"));
});

test.serial("scopes the profile update to the signed-in user", async (t) => {
  stubGeocode({ lat: 38.4404, lng: -122.7141 });
  const { mock } = await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.deepEqual(mock.findBuilder("profiles", "update").argsFor("eq"), ["id", TEST_USER_ID]);
});

test.serial("surfaces an address that can't be found instead of advancing", async (t) => {
  stubGeocode({ found: false });

  const { mock } = await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText(/Couldn't find that address/i));
  t.is(mock.fromCalls.filter((c) => c.table === "profiles").length, 1); // the AuthProvider read only
});

test.serial("surfaces a geocoding service failure instead of advancing", async (t) => {
  stubGeocode({ ok: false });

  await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText(/Couldn't reach the address lookup service/i));
});

test.serial("lands on Search once the profile is complete", async (t) => {
  stubGeocode({ lat: 38.4404, lng: -122.7141 });
  await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByTestId("home"));
});

test.serial("surfaces a failed profile update instead of advancing", async (t) => {
  stubGeocode({ lat: 38.4404, lng: -122.7141 });
  await render({ update: { data: null, error: { message: "permission denied for column is_platform_admin" } } });
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText("permission denied for column is_platform_admin"));
  t.is(screen.queryByTestId("home"), null);
});

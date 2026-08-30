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

test.serial("geocodes the typed address and jitters it instead of storing the exact point as the public pin", async (t) => {
  // The privacy-critical part of the location model: the public pin is derived
  // once, is never equal to the real position, and lands inside the radius.
  stubGeocode({ lat: 38.4404, lng: -122.7141 });

  const { mock } = await render();
  fillRequiredFields();

  fireEvent.click(continueButton());
  await flush();

  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.is(update.home_lat, 38.4404);
  t.is(update.home_lng, -122.7141);
  t.not(update.approx_lat, 38.4404);
  t.not(update.approx_lng, -122.7141);
  t.is(update.pin_placement_mode, "auto_jitter");
  t.is(update.map_pin_hidden, false);

  // Inside the stored radius: 800 m is ~0.0072° of latitude.
  t.true(Math.abs(update.approx_lat - 38.4404) < 0.0072);
  t.is(update.pin_radius_meters, 800);
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
  t.is(update.home_lat, 38.4404);
  t.truthy(update.approx_lat);
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

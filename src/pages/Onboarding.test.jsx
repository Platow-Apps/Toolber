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
  delete globalThis.navigator.geolocation;
});

function app() {
  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/" element={<div data-testid="home">search screen</div>} />
    </Routes>
  );
}

/** Install a geolocation stub for the duration of one test. */
function stubGeolocation(behaviour) {
  Object.defineProperty(navigator, "geolocation", {
    value: {
      getCurrentPosition: (onSuccess, onError) => behaviour(onSuccess, onError),
    },
    writable: true,
    configurable: true,
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
const continueButton = () => screen.getByRole("button", { name: /continue/i });
const tosCheckbox = () => screen.getByRole("checkbox");

function fillNameAndTos(name = "Jordan K.") {
  fireEvent.change(nameField(), { target: { value: name } });
  fireEvent.click(tosCheckbox());
}

test.serial("blocks continuing until name, location choice and ToS are all set", async (t) => {
  await render();

  t.true(continueButton().disabled);

  fireEvent.change(nameField(), { target: { value: "Jordan K." } });
  t.true(continueButton().disabled);

  fireEvent.click(tosCheckbox());
  t.true(continueButton().disabled);

  fireEvent.click(screen.getByText("Hide my tools' location"));
  t.false(continueButton().disabled);
});

test.serial("records ToS acceptance with a version and a timestamp", async (t) => {
  // The ToS acceptance record is the app's only risk acknowledgement — there is
  // deliberately no per-tool competency checkbox.
  const { mock } = await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Hide my tools' location"));

  fireEvent.click(continueButton());
  await flush();

  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.truthy(update.tos_accepted_at);
  t.truthy(update.tos_version);
  t.is(update.profile_complete, true);
  t.is(update.display_name, "Jordan K.");
});

test.serial("hiding the pin stores no coordinates at all", async (t) => {
  const { mock } = await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Hide my tools' location"));

  fireEvent.click(continueButton());
  await flush();

  const update = mock.findBuilder("profiles", "update").argsFor("update")[0];
  t.is(update.map_pin_hidden, true);
  t.is(update.home_lat, undefined);
  t.is(update.approx_lat, undefined);
});

test.serial("scopes the profile update to the signed-in user", async (t) => {
  const { mock } = await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Hide my tools' location"));

  fireEvent.click(continueButton());
  await flush();

  t.deepEqual(mock.findBuilder("profiles", "update").argsFor("eq"), ["id", TEST_USER_ID]);
});

test.serial("jitters the captured position instead of storing it as the public pin", async (t) => {
  // The privacy-critical part of the location model: the public pin is derived
  // once, is never equal to the real position, and lands inside the radius.
  stubGeolocation((onSuccess) => onSuccess({ coords: { latitude: 38.4404, longitude: -122.7141 } }));

  const { mock } = await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Random Pin (recommended)"));

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

test.serial("refuses to fall back silently when location is denied", async (t) => {
  // "No silent fallback": a denied permission must surface a choice, not
  // quietly complete onboarding with no pin.
  stubGeolocation((_onSuccess, onError) => onError({ code: 1 }));

  const { mock } = await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Random Pin (recommended)"));

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText(/Couldn't get your location/i));
  t.is(mock.fromCalls.filter((c) => c.table === "profiles").length, 1); // the AuthProvider read only
});

test.serial("refuses to continue when the browser has no geolocation at all", async (t) => {
  await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Random Pin (recommended)"));

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText(/Couldn't get your location/i));
});

test.serial("lands on Search once the profile is complete", async (t) => {
  await render();
  fillNameAndTos();
  fireEvent.click(screen.getByText("Hide my tools' location"));

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByTestId("home"));
});

test.serial("surfaces a failed profile update instead of advancing", async (t) => {
  await render({ update: { data: null, error: { message: "permission denied for column is_platform_admin" } } });
  fillNameAndTos();
  fireEvent.click(screen.getByText("Hide my tools' location"));

  fireEvent.click(continueButton());
  await flush();

  t.truthy(screen.getByText("permission denied for column is_platform_admin"));
  t.is(screen.queryByTestId("home"), null);
});

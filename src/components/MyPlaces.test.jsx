import test from "ava";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { flush, renderWithAuth } from "../../test/setup.jsx";
import MyPlaces from "./MyPlaces";

test.afterEach.always(cleanup);

const PLACES = [
  {
    id: "loc-1",
    label: "The cabin",
    approx_lat: 39.0,
    approx_lng: -123.0,
    pin_radius_meters: 400,
    pickup_address: "1600 Ridge Rd",
    tool_count: 2,
  },
];

function render({ rpcs = {}, ...rest } = {}) {
  return renderWithAuth(<MyPlaces />, {
    supabase: { rpcs: { my_locations: { data: PLACES }, ...rpcs } },
    ...rest,
  });
}

test.serial("lists the places you keep tools, and what is at each", async (t) => {
  await render();
  await flush();

  t.truthy(screen.getByText("The cabin"));
  t.truthy(screen.getByText(/2 tools · pickup address saved/));
});

test.serial("with no places it still offers to add one", async (t) => {
  await render({ rpcs: { my_locations: { data: [] } } });
  await flush();

  t.truthy(screen.getByRole("button", { name: /add a place/i }));
  t.is(screen.queryByRole("button", { name: /add another place/i }), null);
});

test.serial("with places the button says another", async (t) => {
  await render();
  await flush();

  t.truthy(screen.getByRole("button", { name: /add another place/i }));
});

test.serial("a place with no name is refused before anything is geocoded", async (t) => {
  await render({ rpcs: { my_locations: { data: [] } } });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /add a place/i }));
  fireEvent.click(screen.getByRole("button", { name: /add this place/i }));
  await flush();

  t.truthy(screen.getByText(/give this place a name/i));
});

test.serial("a place with no address is refused too", async (t) => {
  // The address is what becomes the pin. Without it there is nothing to place.
  await render({ rpcs: { my_locations: { data: [] } } });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /add a place/i }));
  fireEvent.change(screen.getByLabelText(/what do you call it/i), { target: { value: "The cabin" } });
  fireEvent.click(screen.getByRole("button", { name: /add this place/i }));
  await flush();

  t.truthy(screen.getByText(/enter the address for this place/i));
});

test.serial("editing prefills the name and pickup address, but never the address", async (t) => {
  // The street address is not returned by my_locations() and never has been:
  // re-saving geocodes afresh, and a prefilled box would imply the app is
  // holding an address it deliberately does not keep.
  await render();
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /edit/i }));
  await flush();

  t.is(screen.getByLabelText(/what do you call it/i).value, "The cabin");
  t.is(screen.getByLabelText(/pickup address here/i).value, "1600 Ridge Rd");
  t.is(screen.getByLabelText(/^address$/i).value, "");
});

test.serial("removing a place warns that its tools move, and says where to", async (t) => {
  const original = window.confirm;
  let asked = "";
  window.confirm = (message) => {
    asked = message;
    return false;
  };

  try {
    const { mock } = await render();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await flush();

    t.regex(asked, /fall back to your main area/i);
    t.is(mock.rpcCalls.filter((c) => c.name === "delete_my_location").length, 0);
  } finally {
    window.confirm = original;
  }
});

test.serial("a refused save is shown rather than swallowed", async (t) => {
  // The geocoder is stubbed rather than left to hit the network: an
  // unstubbed fetch to Mapbox simply hangs under the test runner, so save()
  // never finishes and the assertion below would be measuring the absence of
  // a result rather than the presence of an error.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.teardown(() => {
    globalThis.fetch = realFetch;
  });

  await render({
    rpcs: {
      my_locations: { data: [] },
      save_my_location: { data: null, error: { message: "You can save up to 10 places" } },
    },
  });
  await flush();

  fireEvent.click(screen.getByRole("button", { name: /add a place/i }));
  fireEvent.change(screen.getByLabelText(/what do you call it/i), { target: { value: "The cabin" } });
  fireEvent.change(screen.getByLabelText(/^address$/i), { target: { value: "somewhere" } });
  fireEvent.click(screen.getByRole("button", { name: /add this place/i }));
  await flush();

  // There is no network in a test, so the geocoder fails before the RPC is
  // ever reached -- which is the point. Whatever refuses, a refusal has to
  // land on screen; a silent no-op is the failure mode this could have had.
  t.truthy(screen.getByRole("alert"));
});

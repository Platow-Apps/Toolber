import "./support/polyfills.js";

import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext.jsx";
import { setSupabaseMock } from "./support/supabase-double.js";
import { MockQueryBuilder } from "./support/supabase-mock.js";

export const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

/** The two nav colours, as jsdom serialises them from the inline styles. */
export const COLOR = {
  active: "rgb(242, 185, 11)", // safety yellow, #F2B90B
  inactive: "rgb(124, 128, 135)", // steel, #7C8087
};

/** A minimal session shaped like the one supabase-js hands back. */
export function makeSession(overrides = {}) {
  return {
    access_token: "test-token",
    user: { id: TEST_USER_ID, email: "tester@toolber.test", ...(overrides.user ?? {}) },
    ...overrides,
  };
}

/** A profile row shaped like the columns AuthContext selects. */
export function makeProfile(overrides = {}) {
  return {
    id: TEST_USER_ID,
    display_name: "Test User",
    avatar_url: null,
    approx_lat: 38.48,
    approx_lng: -122.75,
    map_pin_hidden: false,
    profile_complete: true,
    is_platform_admin: false,
    theme_preference: "system",
    ...overrides,
  };
}

/**
 * Let every already-scheduled promise callback and effect settle.
 * Components here load data in effects, so almost every assertion needs this.
 */
export async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      // A macrotask, not just a microtask: AuthContext defers its profile load
      // with setTimeout(…, 0) to avoid deadlocking supabase-js's auth lock, so
      // draining microtasks alone would leave that update outside act().
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * Render inside a MemoryRouter, without any auth context.
 * Use for presentational components.
 */
export function renderWithRouter(ui, { route = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>
  );
}

/**
 * Render inside MemoryRouter + the real AuthProvider, with the Supabase
 * singleton stubbed out.
 *
 * @param {React.ReactElement} ui
 * @param {object} options
 * @param {object|null} [options.session]  falsy = signed out
 * @param {object|null} [options.profile]  the row AuthContext will load
 * @param {object} [options.supabase]      extra makeMockClient config (tables, rpcs, from, auth)
 * @param {string} [options.route]
 * @returns {Promise<{mock: object} & import("@testing-library/react").RenderResult>}
 */
export async function renderWithAuth(
  ui,
  { session = makeSession(), profile = makeProfile(), supabase: supabaseConfig = {}, route = "/" } = {}
) {
  // AuthProvider's initial profile read happens before the screen under test
  // does anything, so when a test supplies its own `from` handler that very
  // first `profiles` call is answered with the auth profile. Everything after
  // it — including the screen's own profile writes — goes to the test's
  // handler, so an update can still be made to fail.
  const customFrom = supabaseConfig.from;
  let profileReads = 0;
  const from = customFrom
    ? (table) =>
        table === "profiles" && profileReads++ === 0
          ? new MockQueryBuilder({ data: profile, error: null })
          : customFrom(table)
    : undefined;

  const mock = setSupabaseMock({
    session,
    ...supabaseConfig,
    ...(from ? { from } : {}),
    tables: { profiles: { data: profile, error: null }, ...(supabaseConfig.tables ?? {}) },
  });

  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );

  await flush();
  return { ...utils, mock };
}

/**
 * Holds a screen back until the session has resolved.
 *
 * Every screen behind `RequireAuth` reads `user.id` unguarded, and RequireAuth
 * only mounts them once `loading` is false. Tests must reproduce that ordering
 * or they crash on the first render for reasons the app never hits.
 */
function AuthGate({ children }) {
  const { loading } = useAuth();
  return loading ? null : children;
}

/**
 * Render a screen the way the app mounts it: inside the router and the auth
 * provider, and only after the session has settled.
 */
export async function renderPage(ui, options = {}) {
  return renderWithAuth(<AuthGate>{ui}</AuthGate>, options);
}

export { setSupabaseMock };
export { MemoryRouter, Route, Routes };
export { getSupabaseMock, resetSupabaseMock } from "./support/supabase-double.js";
export { makeMockClient } from "./support/supabase-mock.js";
export { MockQueryBuilder };
export * from "@testing-library/react";

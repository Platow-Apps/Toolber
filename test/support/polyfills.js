// jsdom gaps that React Testing Library and this app's components trip over.
// Imported first by test/setup.jsx so it runs before any component module is
// evaluated (SearchTagline reads matchMedia at module scope, for example).

// Enable React act() support in jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// mapbox-gl and any future resize-aware component expect this.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom ships matchMedia, but not in every version — SearchTagline calls it at
// module scope, so a missing implementation would throw on import.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Silence jsdom's "not implemented" noise for navigation-adjacent APIs.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

// Onboarding calls navigator.geolocation; jsdom has no implementation at all.
// Default to "unavailable" so the happy path is opt-in per test.
if (typeof navigator !== "undefined" && !navigator.geolocation) {
  Object.defineProperty(navigator, "geolocation", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// Node 18+ ships its own global Event/CustomEvent, which shadow jsdom's.
// Components that construct events with the global constructor and dispatch
// them on jsdom nodes would otherwise be rejected by jsdom.
if (typeof window !== "undefined") {
  for (const key of ["Event", "CustomEvent", "FocusEvent", "KeyboardEvent", "MouseEvent", "PointerEvent"]) {
    const ctor = window[key];
    if (ctor) globalThis[key] = ctor;
  }
}

if (typeof Element !== "undefined") {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
}

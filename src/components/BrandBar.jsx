import { Link, NavLink } from "react-router-dom";
import ToolberIcon from "./ToolberIcon";
import { TABS } from "./BottomNav";
import { useDismissableMenu } from "../lib/useDismissableMenu";
import { useAuth } from "../contexts/AuthContext";
import NotificationBell from "./NotificationBell";

// Sits at the top of every tab's header: "Toolber" wordmark upper-left
// (links home), mascot icon upper-right, which opens a quick-access menu of the
// same 5 destinations as the bottom nav. Page-specific controls (search bar,
// tabs, buttons) go in their own row below this one.
//
// The menu used to open on mouseenter over a plain <div>, which meant it did
// not exist for keyboard users and did not exist on touch devices at all — on a
// phone the icon simply navigated home (docs/audit-2026-08-20.md, A11Y-3). It
// is now a real button that toggles on click, closes on Escape or an outside
// click, and still opens on hover for pointer users.
//
// `children` is an optional middle slot — currently only Search/Login/Signup
// use it, for the tagline (see docs/feature-checklist.md's locked tagline spec).
export default function BrandBar({ children }) {
  const { open: navOpen, setOpen: setNavOpen, ref: navRef } = useDismissableMenu();
  const { open: userOpen, setOpen: setUserOpen, ref: userRef } = useDismissableMenu();
  const { user, profile, signOut } = useAuth();

  // Signals "you're signed in" — first name only (matches the existing
  // greeting-style truncation used elsewhere, e.g. ToolDetail's "coordinate
  // pickup with {name.split(' ')[0]}"). Nothing renders pre-onboarding, when
  // profile.display_name isn't set yet.
  const firstName = profile?.display_name?.split(" ")[0];

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to="/" className="flex-shrink-0 font-condensed text-xl font-bold uppercase tracking-wide text-safety">
        Toolber
      </Link>
      {children}
      {/* Name, bell and mascot icon travel together as one right-pinned
          group — otherwise justify-between spreads the row's leftover space
          across every gap, and the name drifts away from the icon depending
          on how much room the middle slot (tagline) takes up. */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {user ? (
          firstName && (
            // A signed-in visitor's own quick-access menu (Settings, log
            // out) — separate from the mascot's site-navigation menu below,
            // so it needs its own useDismissableMenu instance.
            <div ref={userRef} className="relative flex-shrink-0">
              <button
                type="button"
                aria-label={`Account menu for ${firstName}`}
                aria-haspopup="menu"
                aria-expanded={userOpen}
                onClick={() => setUserOpen((v) => !v)}
                className="flex-shrink-0 truncate text-[0.688rem] font-semibold text-steelLight"
              >
                {firstName}
              </button>

              {userOpen && (
                <div
                  role="menu"
                  aria-label="Account"
                  className="absolute right-0 top-full z-40 w-36 overflow-hidden rounded-lg border border-panelBorder bg-panel py-1 shadow-lg"
                >
                  <Link
                    to="/settings"
                    role="menuitem"
                    onClick={() => setUserOpen(false)}
                    className="block px-3.5 py-2.5 font-condensed text-[0.75rem] font-semibold uppercase tracking-wide text-steelLight hover:text-safety"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserOpen(false);
                      signOut();
                    }}
                    className="block w-full px-3.5 py-2.5 text-left font-condensed text-[0.75rem] font-semibold uppercase tracking-wide text-steelLight hover:text-safety"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          // No indication at all that you were signed out — nothing here
          // told you to log in, you'd just quietly lose access to anything
          // that needs a session.
          <Link to="/login" className="flex-shrink-0 text-[0.688rem] font-semibold text-steelLight underline">
            Log In
          </Link>
        )}
        <NotificationBell />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover is a pointer-only
            enhancement here — the real control is the <button> inside, which is
            keyboard- and touch-operable on its own. */}
        <div
          ref={navRef}
          className="relative flex-shrink-0"
          onMouseEnter={() => setNavOpen(true)}
          onMouseLeave={() => setNavOpen(false)}
        >
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-haspopup="menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center"
          >
            <ToolberIcon className="h-7 w-7" />
          </button>

          {navOpen && (
            <div
              role="menu"
              aria-label="Navigation"
              className="absolute right-0 top-full z-40 w-44 overflow-hidden rounded-lg border border-panelBorder bg-panel py-1 shadow-lg"
            >
              {TABS.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className="group flex items-center gap-2.5 px-3.5 py-2.5"
                >
                  {({ isActive }) => (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                        className={`h-4 w-4 flex-shrink-0 ${isActive ? "stroke-safety" : "stroke-steel group-hover:stroke-safety"}`}
                      >
                        {tab.icon}
                      </svg>
                      <span
                        className={`font-condensed text-[0.75rem] font-semibold uppercase tracking-wide ${
                          isActive ? "text-safety" : "text-steelLight group-hover:text-safety"
                        }`}
                      >
                        {tab.label}
                      </span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

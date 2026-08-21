import { Link, NavLink } from "react-router-dom";
import ToolberIcon from "./ToolberIcon";
import { TABS } from "./BottomNav";
import { useDismissableMenu } from "../lib/useDismissableMenu";
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
// `children` is an optional middle slot — currently only Search uses it, for
// the tagline (see docs/feature-checklist.md's locked tagline spec).
export default function BrandBar({ children }) {
  const { open, setOpen, ref: wrapperRef } = useDismissableMenu();

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to="/" className="flex-shrink-0 font-condensed text-xl font-bold uppercase tracking-wide text-safety">
        Toolber
      </Link>
      {children}
      <NotificationBell />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover is a pointer-only
          enhancement here — the real control is the <button> inside, which is
          keyboard- and touch-operable on its own. */}
      <div
        ref={wrapperRef}
        className="relative flex-shrink-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label="Open navigation menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center"
        >
          <ToolberIcon className="h-7 w-7" />
        </button>

        {open && (
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
                onClick={() => setOpen(false)}
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
  );
}

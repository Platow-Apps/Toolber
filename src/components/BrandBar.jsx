import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import ToolberIcon from "./ToolberIcon";
import { TABS } from "./BottomNav";

// Sits at the top of every tab's header: "Toolber" wordmark upper-left
// (links home), mascot icon upper-right — clicking it still goes home,
// but hovering it now also drops down the same 5 destinations as the
// bottom nav, for quick access without reaching to the bottom of the
// screen. Page-specific controls (search bar, tabs, buttons) go in their
// own row below this one.
// `children` is an optional middle slot — currently only Search uses it,
// for the tagline (see docs/feature-checklist.md's locked tagline spec).
export default function BrandBar({ children }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to="/" className="flex-shrink-0 font-condensed text-xl font-bold uppercase tracking-wide text-safety">
        Toolber
      </Link>
      {children}
      <div
        className="relative flex-shrink-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <Link to="/" aria-label="Go to home" className="flex h-7 w-7 items-center justify-center">
          <ToolberIcon className="h-7 w-7" />
        </Link>

        {open && (
          <div className="absolute right-0 top-full z-40 w-44 overflow-hidden rounded-lg border border-panelBorder bg-panel py-1 shadow-lg">
            {TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} className="flex items-center gap-2.5 px-3.5 py-2.5">
                {({ isActive }) => (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={isActive ? "#F2B90B" : "#7C8087"}
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="h-4 w-4 flex-shrink-0"
                    >
                      {tab.icon}
                    </svg>
                    <span
                      className="font-condensed text-[12px] font-semibold uppercase tracking-wide"
                      style={{ color: isActive ? "#F2B90B" : "#B7BCC2" }}
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

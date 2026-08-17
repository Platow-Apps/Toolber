import { NavLink } from "react-router-dom";

// Exported so BrandBar's icon-dropdown menu can reuse the exact same 5
// destinations instead of maintaining a second, driftable copy.
export const TABS = [
  {
    to: "/",
    label: "Search",
    end: true,
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
  {
    to: "/my-tools",
    label: "My Tools",
    icon: (
      <>
        <rect x="3" y="9" width="18" height="10" rx="1" />
        <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
      </>
    ),
  },
  {
    to: "/groups",
    label: "Groups",
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
        <path d="M16 14.2a4 4 0 0 1 4.5 4" />
      </>
    ),
  },
  {
    to: "/favorites",
    label: "Favorites",
    icon: <path d="M12 20s-7-4.4-9.5-8.8C.7 8 2 4.5 5.5 4a5 5 0 0 1 6.5 2 5 5 0 0 1 6.5-2c3.5.5 4.8 4 3 7.2C19 15.6 12 20 12 20z" />,
  },
  {
    to: "/settings",
    label: "Settings",
    icon: (
      <>
        <path
          d="M18.93,11.03 L18.93,12.97 L16.50,14.60 L16.31,17.52 L14.62,18.49 L12.00,17.20 L9.38,18.49 L7.69,17.52 L7.50,14.60 L5.07,12.97 L5.07,11.03 L7.50,9.40 L7.69,6.48 L9.38,5.51 L12.00,6.80 L14.62,5.51 L16.31,6.48 L16.50,9.40 Z"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.1" />
      </>
    ),
  },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-safety bg-asphalt pb-3.5 pt-3">
      <div className="mx-auto flex w-full max-w-lg">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className="flex flex-1 flex-col items-center gap-1"
          >
            {({ isActive }) => (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isActive ? "#F2B90B" : "#7C8087"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="h-[23px] w-[23px]"
                >
                  {tab.icon}
                </svg>
                <span
                  className="font-condensed text-[10.5px] font-semibold uppercase tracking-wide"
                  style={{ color: isActive ? "#F2B90B" : "#7C8087" }}
                >
                  {tab.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

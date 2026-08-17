import { Link } from "react-router-dom";
import ToolberIcon from "./ToolberIcon";

// Sits at the top of every tab's header: "Toolber" wordmark upper-left,
// mascot icon upper-right, both linking home. Page-specific controls
// (search bar, tabs, buttons) go in their own row below this one.
// `children` is an optional middle slot — currently only Search uses it,
// for the tagline (see docs/feature-checklist.md's locked tagline spec).
export default function BrandBar({ children }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to="/" className="flex-shrink-0 font-condensed text-xl font-bold uppercase tracking-wide text-safety">
        Toolber
      </Link>
      {children}
      <Link to="/" aria-label="Go to home" className="flex-shrink-0">
        <ToolberIcon className="h-7 w-7" />
      </Link>
    </div>
  );
}

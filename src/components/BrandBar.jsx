import { Link } from "react-router-dom";
import ToolberIcon from "./ToolberIcon";

// Sits at the top of every tab's header: "Toolber" wordmark upper-left,
// mascot icon upper-right, both linking home. Page-specific controls
// (search bar, tabs, buttons) go in their own row below this one.
export default function BrandBar() {
  return (
    <div className="mb-3 flex items-center justify-between">
      <Link to="/" className="font-condensed text-xl font-bold uppercase tracking-wide text-safety">
        Toolber
      </Link>
      <Link to="/" aria-label="Go to home">
        <ToolberIcon className="h-7 w-7" />
      </Link>
    </div>
  );
}

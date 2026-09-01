import BrandBar from "./BrandBar";
import useSmartBack from "../lib/useSmartBack";

/**
 * The header every inner screen shares: the Toolber bar, then a back/title row.
 *
 * Tool Detail, Conversation, Create Group and List Tool each had only the
 * second row -- a back arrow and a title on asphalt, with no wordmark, no
 * navigation menu and no notification bell. That is fine when you arrived by
 * tapping through the app, and a dead end when you did not: a borrow-request
 * email drops you straight onto a tool in a brand new tab, where Back has
 * nothing to pop and there is no other way into the rest of the app.
 *
 * @param {object} props
 * @param {string} props.title        shown in the back row, truncated
 * @param {string} [props.backTo]     where Back goes when this is the first page in the tab
 * @param {React.ReactNode} [props.action]  optional control pinned to the right
 */
export default function PageHeader({ title, backTo = "/", action = null }) {
  const goBack = useSmartBack(backTo);

  return (
    <div className="bg-asphalt px-4 pb-3 pt-4">
      <BrandBar />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label="Go back"
          onClick={goBack}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-panel text-safety"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="min-w-0 flex-1 truncate font-condensed text-base font-bold uppercase tracking-wide text-safety">
          {title}
        </p>
        {action}
      </div>
    </div>
  );
}

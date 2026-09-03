import { Link } from "react-router-dom";
import { formatDistance } from "../lib/geo";
import { formatOnLoanUntil, formatPrice, isOverdue, priceClass, statusLabel, statusStyle } from "../lib/toolStatus";
import ToolThumb from "./ToolThumb";

// The tool row used by Search, My Tools, Group Detail and Favorites. It was
// copy-pasted into all four, along with its own copy of the status tables and
// price formatting — see docs/audit-2026-08-20.md (CQ-1).

function ToolboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="9" width="18" height="8" rx="1" />
      <path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

/**
 * @param {object} props
 * @param {object} props.tool           a tools row; `profiles` join optional
 * @param {boolean} [props.showOwner]   show the owner's display name
 * @param {React.ReactNode} [props.action]  trailing control (e.g. a remove button)
 * @param {boolean} [props.dimmed]      render faded (e.g. a paused listing)
 */
export default function ToolCard({ tool, showOwner = true, action = null, dimmed = false }) {
  const photoPath = tool.photos?.[0] ?? null;
  const onLoanUntil = formatOnLoanUntil(tool);
  const overdue = isOverdue(tool);
  // Present only on rows from search_tools() with an origin (0042). Showing it
  // is what makes the proximity ordering legible -- a list that is sorted by
  // something invisible just looks arbitrary.
  const distance = formatDistance(tool.distance_miles);

  const body = (
    <>
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-asphalt text-safety">
        {photoPath ? (
          <ToolThumb path={photoPath} className="h-full w-full object-cover" />
        ) : (
          <ToolboxIcon />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.844rem] font-bold text-asphalt">{tool.name}</span>
        {onLoanUntil && (
          <span className={`mt-0.5 block truncate font-mono text-[0.625rem] ${overdue ? "text-signal" : "text-muted"}`}>
            {overdue ? `${onLoanUntil} — overdue` : onLoanUntil}
          </span>
        )}
        <span className="mt-1 flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${statusStyle(tool.status)}`}
          >
            {statusLabel(tool.status)}
          </span>
          {tool.for_sale && (
            <span className="rounded bg-[#8B6F1F]/10 px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide text-[#8B6F1F]">
              For Sale
            </span>
          )}
          {distance && (
            <span className="flex-shrink-0 font-mono text-[0.625rem] text-muted">{distance}</span>
          )}
          {showOwner && (
            <span className="truncate font-mono text-[0.688rem] text-muted">
              {tool.profiles?.display_name ?? "Unknown"}
            </span>
          )}
        </span>
      </span>
      <span className={`flex-shrink-0 font-mono text-[0.75rem] font-bold ${priceClass(tool)}`}>
        {formatPrice(tool)}
      </span>
    </>
  );

  // A tool that is out (or withdrawn by its owner) reads as dimmed — still
  // browsable, still links through, just not something to act on right now.
  const faded = dimmed || tool.status === "borrowed";
  const fade = faded ? " opacity-60" : "";

  // The clipped top-right corner is the Motorsport direction's card motif.
  //
  // Both this and the dimming live on their own layers rather than on the
  // card container, because `action` can be a dropdown menu that has to
  // escape the card's bounds: clip-path clips every descendant, and an
  // opacity below 1 creates a stacking context that traps a child's z-index
  // inside the card. Together those made an open menu render truncated and
  // underneath the following card.
  const clip = { clipPath: "polygon(0 0,calc(100% - 0.625rem) 0,100% 0.625rem,100% 100%,0 100%)" };
  const surface = (
    <span
      aria-hidden="true"
      style={clip}
      className={`pointer-events-none absolute inset-0 rounded-lg border border-cardBorder bg-white${fade}`}
    />
  );

  // `relative` on the content keeps it painting above the absolutely
  // positioned surface behind it.
  if (action) {
    return (
      <div className="relative flex items-center gap-3 p-3">
        {surface}
        <Link to={`/tool/${tool.id}`} className={`relative flex min-w-0 flex-1 items-center gap-3${fade}`}>
          {body}
        </Link>
        {action}
      </div>
    );
  }

  return (
    <Link to={`/tool/${tool.id}`} className="relative flex items-center gap-3 p-3">
      {surface}
      <span className={`relative flex min-w-0 flex-1 items-center gap-3${fade}`}>{body}</span>
    </Link>
  );
}

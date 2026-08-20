import { Link } from "react-router-dom";
import { formatPrice, priceClass, statusLabel, statusStyle } from "../lib/toolStatus";

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
 */
export default function ToolCard({ tool, showOwner = true, action = null }) {
  const body = (
    <>
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-asphalt text-safety">
        <ToolboxIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.844rem] font-bold text-asphalt">{tool.name}</span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[0.594rem] font-bold uppercase tracking-wide ${statusStyle(tool.status)}`}
          >
            {statusLabel(tool.status)}
          </span>
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

  const shell =
    "flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3";
  // The clipped top-right corner is the Motorsport direction's card motif.
  const clip = { clipPath: "polygon(0 0,calc(100% - 0.625rem) 0,100% 0.625rem,100% 100%,0 100%)" };

  if (action) {
    return (
      <div className={shell} style={clip}>
        <Link to={`/tool/${tool.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
        {action}
      </div>
    );
  }

  return (
    <Link to={`/tool/${tool.id}`} className={shell} style={clip}>
      {body}
    </Link>
  );
}

import { useState } from "react";
import { shareTool, toolUrl } from "../lib/share";

/**
 * "Share" on a tool page. The fallback chain itself lives in lib/share.js,
 * because the owner's manage menu offers the same thing and a chain written
 * twice is a chain that rots on one side.
 */
export default function ShareToolButton({ toolId, toolName, className = "" }) {
  const [state, setState] = useState("idle"); // idle | copied | manual
  const url = toolUrl(toolId);

  async function share() {
    const result = await shareTool(toolId, toolName);
    if (!result.ok) {
      setState("manual");
      return;
    }
    // Only the clipboard path needs saying — the share sheet is its own
    // feedback, and announcing "copied" after it would be a lie.
    if (result.method === "copy") {
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={share}
        className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-racing"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {state === "copied" ? "Link copied" : "Share"}
      </button>

      {state === "manual" && (
        <div className="mt-1.5">
          <p className="mb-1 text-[0.75rem] leading-relaxed text-muted">
            Your browser wouldn't let us copy it — here's the link:
          </p>
          {/* Selectable and pre-selected on focus, because the reason this is
              showing at all is that copying failed. */}
          <input
            readOnly
            value={url}
            aria-label={`Link to ${toolName}`}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-md border border-cardBorder bg-white px-2 py-1.5 font-mono text-[0.75rem] text-asphalt outline-none"
          />
        </div>
      )}
    </div>
  );
}

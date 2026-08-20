import { useEffect, useState } from "react";

// Locked spec — see docs/feature-checklist.md: cycles ONCE through every
// phrase (not a continuous loop), 6s each, then fades away for good. Color
// matches the wordmark (safety yellow). A small icon appears for the 4
// phrases that have one; "Industrial" and "Fasteners & adhesives" are
// category-like too but have no icon spec, same as Industrial originally.
const PHRASE_MS = 6000;
const FADE_MS = 400;

const TAGLINE_ITEMS = [
  { text: "Why buy? Borrow." },
  { text: "Neighborhood tool lending app" },
  { text: "Put your tools to work." },
  { text: "Lawn & Garden", icon: "flower" },
  { text: "Power Tools", icon: "drill" },
  { text: "Automotive", icon: "tire" },
  { text: "Carpentry", icon: "hammer" },
  { text: "Industrial" },
  { text: "Fasteners & adhesives" },
  { text: "Saving $$ for thousands" },
  { text: "Contribute to your community" },
];

function TireIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="#7C8087" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.8" />
      <line x1="12" y1="4.5" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="19.5" />
      <line x1="4.5" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="19.5" y2="12" />
    </svg>
  );
}

function FlowerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="#3B7A3F">
      <circle cx="12" cy="6.3" r="2.7" opacity="0.85" />
      <circle cx="17.2" cy="9.6" r="2.7" opacity="0.85" />
      <circle cx="15.2" cy="16" r="2.7" opacity="0.85" />
      <circle cx="8.8" cy="16" r="2.7" opacity="0.85" />
      <circle cx="6.8" cy="9.6" r="2.7" opacity="0.85" />
      <circle cx="12" cy="12" r="2.3" />
    </svg>
  );
}

function HammerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="#B5602A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.6 4.6l4.8 4.8-2.7 2.7-1.4-1.4-6.4 6.4-2-2 6.4-6.4-1.4-1.4z" />
      <line x1="9" y1="15.5" x2="4.4" y2="20.1" strokeWidth="2.4" />
    </svg>
  );
}

function DrillIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="#F2B90B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 15.5v-4.2L9 8.6v6.6z" />
      <rect x="9" y="8.5" width="7" height="6" rx="1" />
      <path d="M16 10.2h3.2a1.4 1.4 0 0 1 0 2.8H16z" />
      <line x1="19.6" y1="10" x2="21.2" y2="8.2" />
    </svg>
  );
}

const ICONS = { tire: TireIcon, flower: FlowerIcon, hammer: HammerIcon, drill: DrillIcon };

const reduceMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function SearchTagline() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (index < TAGLINE_ITEMS.length - 1) {
      const t = setTimeout(() => setIndex((i) => i + 1), PHRASE_MS);
      return () => clearTimeout(t);
    }
    // Last phrase — let it sit for its duration, then fade away for good.
    const t = setTimeout(() => setVisible(false), PHRASE_MS);
    return () => clearTimeout(t);
  }, [index]);

  useEffect(() => {
    if (!visible) {
      const t = setTimeout(() => setDone(true), reduceMotion ? 0 : FADE_MS);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (done) return null;

  const item = TAGLINE_ITEMS[index];
  const Icon = item.icon ? ICONS[item.icon] : null;

  const isLawnGarden = item.icon === "flower";

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden"
      style={{ opacity: visible ? 1 : 0, transition: reduceMotion ? "none" : `opacity ${FADE_MS}ms ease-in-out` }}
    >
      {Icon && <Icon />}
      <span
        className={`truncate font-condensed text-xs font-semibold uppercase tracking-wide ${
          isLawnGarden ? "text-[#3B7A3F]" : "text-steelLight"
        }`}
      >
        {item.text}
      </span>
    </div>
  );
}

// Visual "pizzazz" for the auth screens — a stand-in for a real photo until
// one's provided. Brushed-aluminum texture (same technique as the tool-card
// backgrounds elsewhere) plus an oversized, low-opacity wrench for mood.
// (This used to also rotate a made-up tagline, but the real, locked tagline
// spec — see docs/feature-checklist.md — belongs next to the wordmark on
// Search's header, not here; see SearchTagline.jsx.)
export default function AuthHero() {
  return (
    <div
      className="relative flex h-48 items-end overflow-hidden"
      style={{
        backgroundColor: "#16181B",
        backgroundImage:
          "linear-gradient(100deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 12%, rgba(0,0,0,.14) 24%, rgba(255,255,255,.08) 40%, rgba(0,0,0,.12) 56%, rgba(255,255,255,.08) 72%, rgba(0,0,0,.12) 88%, rgba(255,255,255,.06) 100%)",
      }}
    >
      <svg aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F2B90B"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute -right-10 -top-8 h-56 w-56 opacity-[0.14]"
      >
        <path d="M14.7 6.3a4 4 0 0 0-5.5 3.7c0 .5.1 1 .3 1.4L3 18l3 3 6.6-6.5c.4.2.9.3 1.4.3a4 4 0 0 0 3.7-5.5l-2.6 2.6-2-2z" />
      </svg>
      <div className="relative z-10 px-6 pb-5">
        <p className="font-condensed text-3xl font-bold uppercase tracking-wide text-redOrange">Toolber</p>
      </div>
    </div>
  );
}

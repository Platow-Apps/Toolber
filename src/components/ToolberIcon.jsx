// The Toolber mascot mark: two disconnected, perpendicular pills forming a
// "T" that also reads as a simple face. The horizontal pill is the eye
// bar — two dark circles sit concentric with its rounded end-caps. The
// vertical pill sits below with a gap, solid, no holes. Used top-right on
// every tab header as a home-link, paired with the "Toolber" wordmark
// top-left.
export default function ToolberIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="4" y="3" width="24" height="8" rx="4" fill="#F2B90B" />
      <circle cx="8" cy="7" r="2.2" fill="#16181B" />
      <circle cx="24" cy="7" r="2.2" fill="#16181B" />
      <rect x="12.5" y="12" width="7" height="15" rx="3.5" fill="#F2B90B" />
    </svg>
  );
}

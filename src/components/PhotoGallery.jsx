import { useRef, useState } from "react";
import { toolPhotoUrl } from "../lib/photos";

// Up to 3 photos, swipeable (native scroll-snap, works with touch drag and
// trackpad alike), with a dot indicator — the spec from
// docs/feature-checklist.md. Renders nothing for a tool with no photos.
export default function PhotoGallery({ photos = [] }) {
  const urls = photos.map(toolPhotoUrl).filter(Boolean);
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);

  if (urls.length === 0) return null;

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.max(0, Math.min(index, urls.length - 1)));
  }

  return (
    <div className="mb-4">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-lg"
      >
        {urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`${i + 1} of ${urls.length}`}
            className="aspect-[4/3] w-full flex-shrink-0 snap-center object-cover"
          />
        ))}
      </div>
      {urls.length > 1 && (
        <div className="mt-1.5 flex justify-center gap-1.5">
          {urls.map((url, i) => (
            <span key={url} className={`h-1.5 w-1.5 rounded-full ${i === active ? "bg-asphalt" : "bg-cardBorder"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

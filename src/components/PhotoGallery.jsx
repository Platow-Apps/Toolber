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
      {/* Bounded height rather than a 4:3 box scaled to the viewport, and
          `object-contain` rather than `object-cover`.

          The old pair did two bad things at once. `w-full` + an aspect ratio
          made the frame as tall as the screen was wide, which on a phone is
          most of the fold and on a desktop is enormous. `object-cover` then
          filled that frame by cropping — so a portrait photo of a drill was
          shown as a zoomed-in slice of its middle. Nobody can judge a tool
          from that.

          ~14rem/17rem is roughly a 3x5in print at typical densities, which is
          the size a photo of a tool actually needs to be. Contained, so
          portrait and landscape both arrive whole; the letterboxing sits on a
          neutral track instead of cropping the subject away. */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-lg bg-[#F1EFE9]"
      >
        {urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`${i + 1} of ${urls.length}`}
            className="h-[14rem] w-full flex-shrink-0 snap-center object-contain sm:h-[17rem]"
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

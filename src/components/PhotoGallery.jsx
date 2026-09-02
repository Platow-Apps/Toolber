import { toolPhotoUrl } from "../lib/photos";

// A tool's photos, shown next to each other at a size you can actually judge
// a tool from. Renders nothing for a tool with no photos.
export default function PhotoGallery({ photos = [] }) {
  const urls = photos.map(toolPhotoUrl).filter(Boolean);

  if (urls.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Each image is sized by its height and left to take whatever width it
          needs, rather than being stretched to the full container.

          The previous version gave every photo `w-full` and contained it
          inside, which meant a portrait photo sat in the middle of a very wide
          box with large empty margins either side — the image looked small
          while occupying a lot of screen, and the next photo was a swipe away
          rather than visible. Auto width removes the dead space, so two photos
          of a drill sit side by side and both are legible at a glance.

          21rem/25.5rem is the old 14/17 up by half. Contained, so portrait and
          landscape both arrive whole and nothing is cropped. */}
      {/* Two layouts, because the two screens want different things.

          On a phone the row scrolls sideways and each photo may be nearly the
          full width — that reads well and is what a thumb expects.

          On a desktop that same row overflowed: at 25.5rem tall a landscape
          photo is over 30rem wide, so two of them ran past the window and you
          had to scroll to find the second, seeing mostly empty track in
          between. There it wraps instead, and each photo is capped at half the
          row so two sit together and a third moves to the next line. No
          horizontal scrollbar, nothing hidden off-screen. */}
      <div className="flex snap-x gap-2 overflow-x-auto rounded-lg sm:flex-wrap sm:overflow-x-visible">
        {urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`${i + 1} of ${urls.length}`}
            className="h-[21rem] w-auto max-w-[85vw] flex-shrink-0 snap-start rounded-lg bg-[#F1EFE9] object-contain sm:h-[22rem] sm:max-w-[calc(50%-0.25rem)]"
          />
        ))}
      </div>
    </div>
  );
}

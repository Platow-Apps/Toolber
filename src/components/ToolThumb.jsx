import { useState } from "react";
import { toolPhotoUrl, toolThumbUrl } from "../lib/photos";

/**
 * A tool's photo at list size, served from the 320px thumbnail rather than
 * the 1600px original -- a screen of results used to download the full image
 * once per row to render it at 44px.
 *
 * Falls back to the full-size photo if the thumbnail 404s, which is the
 * normal case for anything uploaded before thumbnails existed: those photos
 * have no `.thumb.jpg` sibling and never will, since there is no server-side
 * backfill. Without the fallback they would render as broken images.
 *
 * @param {object} props
 * @param {string} [props.path]   storage path of the full-size photo
 * @param {string} props.alt
 * @param {string} [props.className]
 */
export default function ToolThumb({ path, alt = "", className }) {
  const [useFull, setUseFull] = useState(false);
  const [lastPath, setLastPath] = useState(path);

  // Reset during render rather than in an effect: a different photo deserves
  // a fresh attempt at its own thumbnail, and without this one missing thumb
  // would pin every later photo shown by this same element to full size.
  // React's documented way to adjust state when a prop changes -- an effect
  // here would depend on a value it never reads.
  if (path !== lastPath) {
    setLastPath(path);
    setUseFull(false);
  }

  const src = useFull ? toolPhotoUrl(path) : toolThumbUrl(path);
  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setUseFull(true)}
      className={className}
    />
  );
}

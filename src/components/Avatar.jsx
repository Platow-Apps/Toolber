import { useState } from "react";
import { avatarUrl } from "../lib/avatars";

/**
 * A person's picture, or the first letter of their name on a coloured circle.
 *
 * The letter was the only avatar the app had, written out separately in each
 * place that showed one. Now that a picture can exist, the choice between the
 * two has to be made identically everywhere — including the case where a photo
 * was set and later became unreachable, which is what onError covers. A broken
 * image icon next to someone's name is worse than the letter it replaced.
 *
 * @param {object} props
 * @param {string} [props.path]   storage path from profiles.avatar_url
 * @param {string} [props.name]   display name, for the fallback letter and alt text
 * @param {string} [props.className]  sizing — callers own it, since 44px in the
 *   nav and 64px on Settings are the same component at different scales
 */
export default function Avatar({ path, name, className = "h-11 w-11" }) {
  const [failed, setFailed] = useState(false);
  const [lastPath, setLastPath] = useState(path);

  // Reset during render rather than in an effect, the same way ToolThumb does:
  // a different photo deserves its own attempt, and without this one broken
  // image would pin every later one shown by this element to the letter.
  if (path !== lastPath) {
    setLastPath(path);
    setFailed(false);
  }

  const src = failed ? null : avatarUrl(path);
  const letter = (name ?? "?").trim().charAt(0).toUpperCase() || "?";

  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name}'s profile picture` : "Profile picture"}
        onError={() => setFailed(true)}
        className={`flex-shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center rounded-full bg-asphalt font-bold text-safety ${className}`}
    >
      {letter}
    </span>
  );
}

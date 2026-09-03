import { shrinkImage } from "./photos";
import { supabase } from "./supabaseClient";

/**
 * Profile pictures.
 *
 * Same shape as tool photos (0016 / 0041): a public bucket, writes scoped to a
 * folder named after the uploader's own id, and the *path* stored on the row
 * rather than a URL. `profiles.avatar_url` is named url and holds a path --
 * see the column comment in 0041 for why that mismatch was left alone.
 */

const BUCKET = "avatars";

// An avatar is rendered at 44px in the nav and a little larger on Settings.
// 256 covers that at 3x on a high-DPI screen and keeps a phone-camera original
// from becoming a 4MB download on every page that shows a name.
const AVATAR_DIMENSION = 256;
const AVATAR_QUALITY = 0.8;

/** Public URL for a stored avatar path, or null when there is none. */
export function avatarUrl(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Shrink, upload, and return the stored path for the caller to save on the
 * profile row.
 *
 * Throws on failure. A profile picture that silently did not save is the
 * stuck-checkbox problem again: the person sees their crop, reloads, and finds
 * the old one back with nothing explaining it.
 */
export async function uploadAvatar(userId, file) {
  const image = await shrinkImage(file, AVATAR_DIMENSION, AVATAR_QUALITY);
  // shrinkImage returns the original when it cannot improve on it -- a small
  // PNG, or a browser without canvas -- so the extension follows what is
  // actually being uploaded rather than what arrived.
  const ext = image === file ? (file.name.split(".").pop()?.toLowerCase() || "jpg") : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, image, { contentType: image.type || "image/jpeg" });
  if (error) throw error;

  return path;
}

/**
 * Best-effort removal of an avatar file.
 *
 * Deliberately does not throw. Every caller has already updated the profile
 * row by the time this runs, so a failure leaves an orphaned file in the
 * bucket -- untidy, harmless, and not worth an error message about an action
 * that succeeded.
 */
export async function removeAvatar(path) {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) console.warn("Could not remove the old avatar", path, error);
  } catch (err) {
    console.warn("Could not remove the old avatar", path, err);
  }
}

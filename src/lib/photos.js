import { supabase } from "./supabaseClient";

// See 0016_tool_photos_storage.sql -- tools.photos stores Storage *paths*
// (chest_id/random.ext), not full URLs, so every consumer needs to turn a
// path back into something an <img> can load.
const BUCKET = "tool-photos";

/** Public URL for a stored tool-photo path, or null for no path. */
export function toolPhotoUrl(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Uploads one photo under the signed-in user's own folder (required by the
 * bucket's owner-write policy) and returns the stored path to save on the
 * tool row. Throws on failure -- callers should surface the error rather
 * than silently listing the tool without that photo.
 */
export async function uploadToolPhoto(userId, file) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

/**
 * Best-effort cleanup of storage objects for photos that are no longer
 * referenced -- a deleted tool, or images dropped while editing one.
 *
 * Deliberately does not throw. The tool row is the source of truth and has
 * already been updated by the time this runs; a failure here leaves an
 * orphaned file in the bucket, which is untidy but harmless, and is not worth
 * showing the user an error over an action that already succeeded.
 */
export async function removeToolPhotos(paths) {
  const real = (paths ?? []).filter(Boolean);
  if (real.length === 0) return;
  // try/catch as well as the error field: this runs *after* the tool row is
  // already gone, so letting anything escape here would surface a failure for
  // an action that actually succeeded.
  try {
    const { error } = await supabase.storage.from(BUCKET).remove(real);
    if (error) console.warn("Failed to remove tool photos:", error);
  } catch (err) {
    console.warn("Failed to remove tool photos:", err);
  }
}

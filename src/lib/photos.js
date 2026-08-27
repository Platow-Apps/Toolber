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

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

// A photo straight off a phone is routinely 3000-4000px and several MB. At
// the sizes this app actually renders one (a 44px map thumbnail, a 4:3
// gallery no wider than a phone screen) that is pure waste twice over: a slow
// upload for the owner, and a slow download for everyone who ever sees the
// listing. Downscaling to fit this box keeps a photo comfortably sharp on a
// high-DPI screen while cutting the typical file by an order of magnitude.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Downscale an image to fit MAX_DIMENSION on its longest side, re-encoded as
 * JPEG. Aspect ratio is preserved, so portrait and landscape are both simply
 * bounded -- neither is cropped here (the gallery does its own 4:3 framing at
 * render time).
 *
 * Returns the original File untouched if it is already small enough, if it
 * isn't a raster image, or if anything in the canvas path fails -- a photo
 * that uploads at full size is a far better outcome than one that doesn't
 * upload at all.
 */
export async function shrinkImage(file) {
  if (!file?.type?.startsWith("image/")) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;

    const name = file.name.replace(/.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
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

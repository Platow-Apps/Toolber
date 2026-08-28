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

// Every list in the app renders a photo at 44px. Even the 1600px "full" copy
// is far more than that needs, and a screen of 20 results paid for it 20
// times over. 320px covers a 44px box at 3x DPI with room to spare.
//
// Supabase's own image-transformation API would do this server-side from a
// single stored original, but it is a paid add-on; generating the second file
// at upload time costs one extra request and works on the free tier.
const THUMB_DIMENSION = 320;
const THUMB_QUALITY = 0.72;

/**
 * Where a photo's thumbnail lives, derived from the full-size path so the
 * `tools.photos` column does not have to carry both.
 *
 * Keeps the owner's id as the first path segment, which is what the bucket's
 * owner-write policy checks (0016_tool_photos_storage.sql).
 */
export function thumbPathFor(path) {
  if (!path) return null;
  return `${path.replace(/\.[^./]+$/, "")}.thumb.jpg`;
}

/**
 * Public URL for a photo's thumbnail. Callers must cope with this 404ing:
 * photos uploaded before thumbnails existed have no thumb file, which is what
 * ToolThumb's fallback handles.
 */
export function toolThumbUrl(path) {
  return toolPhotoUrl(thumbPathFor(path));
}

/**
 * Downscale an image to fit `maxDimension` on its longest side, re-encoded as
 * JPEG. Aspect ratio is preserved, so portrait and landscape are both simply
 * bounded -- neither is cropped here (the gallery does its own 4:3 framing at
 * render time).
 *
 * Returns the original File untouched if it is already small enough, if it
 * isn't a raster image, or if anything in the canvas path fails -- a photo
 * that uploads at full size is a far better outcome than one that doesn't
 * upload at all.
 */
export async function shrinkImage(file, maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY) {
  if (!file?.type?.startsWith("image/")) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
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
 *
 * A thumbnail is written alongside it, best-effort: a listing whose thumb
 * failed to upload still renders (ToolThumb falls back to the full image),
 * so a thumbnail problem must not fail the listing itself.
 */
export async function uploadToolPhoto(userId, file) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;

  try {
    const thumb = await shrinkImage(file, THUMB_DIMENSION, THUMB_QUALITY);
    // shrinkImage hands back the original when it cannot do better. Uploading
    // a full-size file under a .thumb name would be worse than having no
    // thumb at all, since the fallback already covers a missing one.
    if (thumb !== file) {
      await supabase.storage
        .from(BUCKET)
        .upload(thumbPathFor(path), thumb, { contentType: "image/jpeg" });
    }
  } catch (err) {
    console.warn("Failed to upload thumbnail for", path, err);
  }

  return path;
}

/**
 * Best-effort cleanup of storage objects for photos that are no longer
 * referenced -- a deleted tool, or images dropped while editing one. Removes
 * each photo's thumbnail too, or they would accumulate forever with nothing
 * left pointing at them.
 *
 * Deliberately does not throw. The tool row is the source of truth and has
 * already been updated by the time this runs; a failure here leaves an
 * orphaned file in the bucket, which is untidy but harmless, and is not worth
 * showing the user an error over an action that already succeeded.
 */
export async function removeToolPhotos(paths) {
  const real = (paths ?? []).filter(Boolean);
  if (real.length === 0) return;
  // Removing a path that does not exist is a no-op, so listing thumbs for
  // photos that predate them is harmless.
  const targets = [...real, ...real.map(thumbPathFor)];
  // try/catch as well as the error field: this runs *after* the tool row is
  // already gone, so letting anything escape here would surface a failure for
  // an action that actually succeeded.
  try {
    const { error } = await supabase.storage.from(BUCKET).remove(targets);
    if (error) console.warn("Failed to remove tool photos:", error);
  } catch (err) {
    console.warn("Failed to remove tool photos:", err);
  }
}

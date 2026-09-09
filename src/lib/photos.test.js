import test from "ava";
import "../../test/support/polyfills.js";
import { setSupabaseMock } from "../../test/support/supabase-double.js";
import {
  fileFromStoredPhoto,
  hashFile,
  rotateImage,
  shrinkImage,
  thumbPathFor,
  toolPhotoUrl,
  uploadToolPhoto,
} from "./photos.js";

test.serial("toolPhotoUrl returns null for a falsy path", (t) => {
  setSupabaseMock({});
  t.is(toolPhotoUrl(null), null);
  t.is(toolPhotoUrl(undefined), null);
  t.is(toolPhotoUrl(""), null);
});

test.serial("toolPhotoUrl asks the tool-photos bucket for a public URL", (t) => {
  let requestedBucket;
  let requestedPath;
  setSupabaseMock({
    storage: (bucket) => ({
      getPublicUrl(path) {
        requestedBucket = bucket;
        requestedPath = path;
        return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
      },
    }),
  });

  t.is(toolPhotoUrl("user-1/abc.jpg"), "https://cdn.test/tool-photos/user-1/abc.jpg");
  t.is(requestedBucket, "tool-photos");
  t.is(requestedPath, "user-1/abc.jpg");
});

test.serial("uploadToolPhoto stores under the user's own folder and returns the path", async (t) => {
  let uploadArgs;
  setSupabaseMock({
    storage: (bucket) => ({
      upload(path, file, opts) {
        uploadArgs = { bucket, path, file, opts };
        return Promise.resolve({ data: { path }, error: null });
      },
    }),
  });

  const file = new File(["x"], "ladder.png", { type: "image/png" });
  const path = await uploadToolPhoto("user-1", file);

  t.is(uploadArgs.bucket, "tool-photos");
  t.regex(uploadArgs.path, /^user-1\/[0-9a-f-]+\.png$/);
  t.is(path, uploadArgs.path);
  t.is(uploadArgs.opts.contentType, "image/png");
});

test.serial("uploadToolPhoto throws the storage error rather than swallowing it", async (t) => {
  setSupabaseMock({
    storage: () => ({
      upload() {
        return Promise.resolve({ data: null, error: { message: "Storage quota exceeded" } });
      },
    }),
  });

  let caught = null;
  try {
    await uploadToolPhoto("user-1", new File(["x"], "a.jpg", { type: "image/jpeg" }));
  } catch (err) {
    caught = err;
  }
  t.is(caught?.message, "Storage quota exceeded");
});

// ── shrinkImage ─────────────────────────────────────────────────────────
// jsdom has no real canvas or createImageBitmap, so these cover the guard
// paths that decide whether to attempt a resize at all — which is exactly
// where a failure would cost someone their upload.

test.serial("passes non-images straight through untouched", async (t) => {
  const pdf = new File(["x"], "manual.pdf", { type: "application/pdf" });
  t.is(await shrinkImage(pdf), pdf);
});

test.serial("passes through anything with no type at all", async (t) => {
  const blob = new File(["x"], "mystery");
  t.is(await shrinkImage(blob), blob);
});

test.serial("returns the original when the image can't be decoded", async (t) => {
  // A corrupt or unsupported image must still upload at full size rather than
  // failing the listing outright.
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => Promise.reject(new Error("decode failed"));
  const file = new File(["not really a jpeg"], "broken.jpg", { type: "image/jpeg" });
  t.is(await shrinkImage(file), file);
  globalThis.createImageBitmap = original;
});

test.serial("leaves an already-small image alone instead of re-encoding it", async (t) => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => Promise.resolve({ width: 800, height: 600, close() {} });
  const file = new File(["x"], "small.jpg", { type: "image/jpeg" });
  t.is(await shrinkImage(file), file);
  globalThis.createImageBitmap = original;
});

// ── Thumbnails ──────────────────────────────────────────────────────────

test("derives a thumbnail path that keeps the owner's folder", (t) => {
  // The bucket's write policy checks the first path segment against
  // auth.uid() (0016_tool_photos_storage.sql), so the thumb has to stay in
  // the same folder or the owner could not upload it.
  t.is(thumbPathFor("user-1/abc.jpg"), "user-1/abc.thumb.jpg");
  t.is(thumbPathFor("user-1/abc.png"), "user-1/abc.thumb.jpg");
  t.is(thumbPathFor("user-1/abc"), "user-1/abc.thumb.jpg");
});

test("has no thumbnail path for no photo", (t) => {
  t.is(thumbPathFor(null), null);
  t.is(thumbPathFor(""), null);
});

test("does not mistake a dot in a folder name for an extension", (t) => {
  t.is(thumbPathFor("user.1/abc"), "user.1/abc.thumb.jpg");
});

// ─── Rotation ────────────────────────────────────────────────────────

test.serial("hands back a non-image untouched rather than corrupting it", async (t) => {
  const notAnImage = new File(["hello"], "notes.txt", { type: "text/plain" });
  t.is(await rotateImage(notAnImage), notAnImage);
});

test.serial("hands back the original when the browser cannot decode it", async (t) => {
  // jsdom has no real canvas or createImageBitmap, which is the same shape as
  // a browser that fails partway: a photo that uploads unrotated is a far
  // better outcome than one that cannot be uploaded at all.
  const file = new File([new Uint8Array([1, 2, 3])], "tool.jpg", { type: "image/jpeg" });
  t.is(await rotateImage(file), file);
});

test.serial("a stored photo that cannot be fetched back yields null, not a throw", async (t) => {
  // The caller's fallback is to leave the photo alone, which is always safe.
  // Set explicitly rather than inherited: an earlier test in this file swaps
  // in a storage stub with no getPublicUrl, and test order should not decide
  // whether this one can resolve a URL.
  setSupabaseMock({
    storage: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }),
  });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  t.is(await fileFromStoredPhoto("chest-1/a.jpg"), null);
});

test.serial("a missing stored photo yields null too", async (t) => {
  // Set explicitly rather than inherited: an earlier test in this file swaps
  // in a storage stub with no getPublicUrl, and test order should not decide
  // whether this one can resolve a URL.
  setSupabaseMock({
    storage: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }),
  });
  globalThis.fetch = async () => ({ ok: false });
  t.is(await fileFromStoredPhoto("chest-1/gone.jpg"), null);
});

test.serial("no path means nothing to fetch", async (t) => {
  t.is(await fileFromStoredPhoto(null), null);
});

test.serial("hashing degrades to null rather than throwing where it is unavailable", async (t) => {
  // crypto.subtle needs a secure context, so it is genuinely absent over
  // plain http. A duplicate slipping through is a much smaller problem than a
  // photo that will not attach, so the caller adds the photo either way.
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });

  t.is(await hashFile(new File(["bytes"], "a.jpg", { type: "image/jpeg" })), null);

  Object.defineProperty(globalThis, "crypto", { value: real, configurable: true, writable: true });
});

test.serial("the same bytes hash the same, different bytes do not", async (t) => {
  const a = new File(["identical"], "one.jpg", { type: "image/jpeg" });
  const renamed = new File(["identical"], "IMG_4821.jpg", { type: "image/jpeg" });
  const different = new File(["not the same"], "one.jpg", { type: "image/jpeg" });

  // Name is deliberately not part of it: a photo re-picked from a phone's
  // gallery often arrives renamed.
  t.is(await hashFile(a), await hashFile(renamed));
  t.not(await hashFile(a), await hashFile(different));
});

test.serial("the test environment has SubtleCrypto, like every browser does", async (t) => {
  // Pinned because its absence is silent: hashFile returns null, de-duplication
  // simply never fires, and the only symptom is a test asserting a notice that
  // never appears. jsdom replaces Node's global crypto with one that has no
  // subtle, and whether that replacement takes hold depends on the Node
  // version — which is how this passed locally and failed in CI on the same
  // commit.
  t.truthy(globalThis.crypto?.subtle, "test/support/polyfills.js should restore webcrypto");
});

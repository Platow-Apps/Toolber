import test from "ava";
import { setSupabaseMock } from "../../test/support/supabase-double.js";
import { toolPhotoUrl, uploadToolPhoto } from "./photos.js";

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

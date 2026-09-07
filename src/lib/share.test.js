import test from "ava";
import { shareTool, toolUrl } from "./share.js";

// jsdom's own origin, rather than one we invent: window.location is not
// writable here, and asserting against the real value is what the code does.
const ORIGIN = window.location.origin;

// jsdom defines navigator as a getter-only property, so a plain assignment
// throws rather than replacing it.
function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

test.beforeEach(() => {
  setNavigator({});
});

test.serial("a tool link is the public page, not an app-internal route", (t) => {
  // The whole point is that it opens for someone with no account.
  t.is(toolUrl("tool-1"), `${ORIGIN}/tool/tool-1`);
});

test.serial("prefers the system share sheet where there is one", async (t) => {
  let got = null;
  setNavigator({
    share: async (payload) => {
      got = payload;
    },
    clipboard: {
      writeText: async () => {
        throw new Error("clipboard should not be reached");
      },
    },
  });

  const result = await shareTool("tool-1", "Wet tile saw");

  t.deepEqual(result, { ok: true, method: "share" });
  t.is(got.url, `${ORIGIN}/tool/tool-1`);
  t.is(got.title, "Wet tile saw");
});

test.serial("dismissing the share sheet is a decision, not a failure", async (t) => {
  // Falling through to the clipboard would put a link someone just declined to
  // send into their clipboard anyway.
  let copied = false;
  setNavigator({
    share: async () => {
      const err = new Error("cancelled");
      err.name = "AbortError";
      throw err;
    },
    clipboard: {
      writeText: async () => {
        copied = true;
      },
    },
  });

  const result = await shareTool("tool-1", "Wet tile saw");

  t.deepEqual(result, { ok: true, method: "share" });
  t.false(copied, "a dismissed share must not silently copy");
});

test.serial("falls back to the clipboard when the sheet errors for real", async (t) => {
  setNavigator({
    share: async () => {
      throw new Error("not allowed");
    },
    clipboard: { writeText: async () => {} },
  });

  t.deepEqual(await shareTool("tool-1", "Wet tile saw"), { ok: true, method: "copy" });
});

test.serial("copies where there is no share sheet at all", async (t) => {
  let written = null;
  setNavigator({
    clipboard: {
      writeText: async (text) => {
        written = text;
      },
    },
  });

  t.deepEqual(await shareTool("tool-1", "Wet tile saw"), { ok: true, method: "copy" });
  t.is(written, `${ORIGIN}/tool/tool-1`);
});

test.serial("hands back the URL when neither API is available", async (t) => {
  // Both need a secure context and can be refused outright. A share control
  // that silently does nothing is worse than one that shows you the link.
  setNavigator({});

  t.deepEqual(await shareTool("tool-1", "Wet tile saw"), {
    ok: false,
    url: `${ORIGIN}/tool/tool-1`,
  });
});

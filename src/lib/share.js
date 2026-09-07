/**
 * Handing someone a link to a tool.
 *
 * A tool page is public and works signed out — that is what makes sharing one
 * useful, and it is the app's cheapest introduction to itself: "I've got a
 * tile saw, here it is" lands better than any description of the product.
 *
 * Three outcomes, in order of how good they are:
 *
 *   1. The system share sheet, where the browser has one. On a phone this is
 *      the whole point — it reaches Messages, WhatsApp, Nextdoor and the rest
 *      without anyone picking an app inside our UI.
 *   2. The clipboard, on a desktop browser or wherever `share` is missing.
 *   3. Neither, and the caller shows the bare URL. Both APIs need a secure
 *      context and can be refused outright, and a share control that silently
 *      does nothing is worse than one that just shows you the link.
 *
 * Lives here rather than inside the button because two places offer this — the
 * tool page, and the owner's own manage menu — and the fallback chain is
 * exactly the kind of thing that rots when it is written twice.
 */

/** The public, signed-out-visitable address of a tool. */
export function toolUrl(toolId) {
  return `${window.location.origin}/tool/${toolId}`;
}

/**
 * @returns {Promise<{ok: true, method: "share"|"copy"} | {ok: false, url: string}>}
 *   `ok: false` is not an error — it means neither API was available, and the
 *   caller should show `url` for the person to copy by hand.
 */
export async function shareTool(toolId, toolName) {
  const url = toolUrl(toolId);

  if (navigator.share) {
    try {
      await navigator.share({ title: toolName, url });
      return { ok: true, method: "share" };
    } catch (err) {
      // Dismissing the sheet rejects with AbortError. That is a decision, not
      // a failure: falling through to the clipboard would put a link someone
      // just declined to send into their clipboard anyway.
      if (err?.name === "AbortError") return { ok: true, method: "share" };
      // Anything else — try to copy instead.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return { ok: true, method: "copy" };
  } catch {
    return { ok: false, url };
  }
}

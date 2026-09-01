import test from "ava";
import { describePushFailure, permissionState, pushSupported } from "./push.js";

// jsdom has no PushManager and no Notification, which is exactly the shape of
// a browser that cannot do push — so the unsupported path is testable for
// free, and the rest of the module is guarded behind it.

test("reports push as unsupported where the APIs are missing", (t) => {
  t.false(pushSupported());
  t.is(permissionState(), "unsupported");
});

test("a blocked permission is explained as unrecoverable from in here", (t) => {
  // The important distinction. Once denied, the prompt cannot be shown again
  // from script, so telling someone to "try again" would be a lie.
  const message = describePushFailure("denied");
  t.regex(message, /blocked/i);
  t.regex(message, /site settings/i);
});

test("an iPhone is told the actual prerequisite", (t) => {
  // Safari only exposes push to a PWA that has been added to the home screen.
  // "Your browser doesn't support this" would be true and useless.
  t.regex(describePushFailure("unsupported"), /home screen/i);
});

test("every failure reason produces something a person can act on", (t) => {
  for (const reason of [
    "unsupported",
    "not-configured",
    "denied",
    "default",
    "subscribe-failed",
    "save-failed",
    "something-new",
  ]) {
    const message = describePushFailure(reason);
    t.true(message.length > 10, `"${reason}" produced too short a message`);
    // No raw reason codes leaking into the UI.
    t.false(message.includes(reason), `"${reason}" leaked its code into the copy`);
  }
});

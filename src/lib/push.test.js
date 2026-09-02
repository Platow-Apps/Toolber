import test from "ava";
import {
  describePushFailure,
  dismissPushPrompt,
  permissionState,
  pushSupported,
  shouldOfferPush,
} from "./push.js";

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

test("a save failure carries the underlying error, not just an apology", (t) => {
  // The generic version is what made a failed registration undiagnosable:
  // the switch read "on" (the browser was subscribed) and the message said
  // only "couldn't save this device".
  const message = describePushFailure("save-failed", "permission denied for table push_subscriptions");
  t.regex(message, /permission denied for table push_subscriptions/);
});

test("a reason with no detail still reads as a sentence", (t) => {
  const message = describePushFailure("save-failed");
  t.false(message.includes("undefined"));
  t.false(message.includes("()"));
});

test.serial("does not offer push where the browser cannot do it", async (t) => {
  // jsdom has no PushManager. Offering a card whose only button cannot work
  // is worse than staying quiet.
  t.false(await shouldOfferPush());
});

test.serial("does not offer push again once it has been declined", async (t) => {
  dismissPushPrompt();
  t.false(await shouldOfferPush());
  t.is(window.localStorage.getItem("toolber:pushPromptDismissed"), "1");
  window.localStorage.clear();
});

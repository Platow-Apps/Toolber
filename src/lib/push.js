import { supabase } from "./supabaseClient";

/**
 * Web push, from the browser's side.
 *
 * A subscription belongs to a *browser*, not to a person: the same neighbor on
 * a phone and a laptop registers twice and both should ring. Everything here
 * is therefore about the current device, and Settings shows the state of this
 * device only.
 */

const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY ?? "";

/** True when this browser can do web push at all. */
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True when the app is configured to send push at all. */
export function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY);
}

/**
 * "granted" | "denied" | "default" | "unsupported"
 *
 * Worth distinguishing "denied" from "default" in the UI: a denied permission
 * cannot be re-requested from script — the prompt simply never appears again —
 * so the only honest thing to tell someone is to change it in browser settings.
 */
export function permissionState() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * The VAPID public key has to reach PushManager.subscribe as bytes, and it is
 * distributed as base64url. atob wants standard base64, hence the swap and the
 * padding.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** ArrayBuffer -> base64url, which is the shape the push protocol wants. */
function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The current browser's existing subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Ask permission, subscribe, and record the subscription against the account.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 *   Never throws: every failure here is something the UI has to explain, and
 *   an exception would just become a generic error banner.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!pushConfigured()) return { ok: false, reason: "not-configured" };

  // Asking is a one-shot: a denied prompt cannot be shown again from script,
  // so the caller is responsible for only reaching here on a deliberate tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission };

  const registration = await navigator.serviceWorker.ready;

  // Reuse an existing subscription rather than creating a second one for the
  // same browser. subscribe() with different options would throw anyway.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        // Non-negotiable on every current browser: a subscription that could
        // wake the app silently is not allowed, so every push shows a
        // notification. That is also why push-sw.js always calls
        // showNotification, even for a payload it cannot parse.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      console.error("Push subscribe failed", err);
      return { ok: false, reason: "subscribe-failed" };
    }
  }

  const p256dh = subscription.getKey?.("p256dh");
  const auth = subscription.getKey?.("auth");
  if (!p256dh || !auth) return { ok: false, reason: "subscribe-failed" };

  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: bufferToBase64Url(p256dh),
    p_auth: bufferToBase64Url(auth),
    p_user_agent: navigator.userAgent?.slice(0, 300) ?? null,
  });
  if (error) {
    console.error("Could not record push subscription", error);
    // The message travels with the reason. Without it the UI could only say
    // "couldn't save", which is exactly as much as we knew when this failed
    // silently in the first place.
    return { ok: false, reason: "save-failed", detail: error.message };
  }

  return { ok: true };
}

/**
 * Whether the *server* has this browser's subscription.
 *
 * The distinction matters more than it looks. A browser holds a subscription
 * the moment PushManager.subscribe() resolves, which is before we have told
 * the database about it -- so "the browser is subscribed" and "we can send to
 * this browser" are different facts, and only the second one is worth showing
 * on a switch. Reading the first and labelling it the second is what made a
 * failed registration look like a working one.
 */
export async function isRegistered() {
  const subscription = await currentSubscription();
  if (!subscription) return false;

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", subscription.endpoint)
    .is("expired_at", null)
    .maybeSingle();

  if (error) {
    console.error("Could not check push registration", error);
    return false;
  }
  return Boolean(data);
}

/**
 * Stop push on this device.
 *
 * Unsubscribes from the push service *and* removes the row. Doing only the
 * first would leave a dead endpoint we keep trying to send to; only the second
 * would leave the browser subscribed to a sender that no longer knows it.
 */
export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return { ok: true };

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});

  const { error } = await supabase.rpc("unregister_push_subscription", { p_endpoint: endpoint });
  if (error) {
    console.error("Could not remove push subscription", error);
    return { ok: false, reason: "save-failed" };
  }
  return { ok: true };
}

/**
 * Human-readable reason for a failed enablePush().
 *
 * @param {string} reason
 * @param {string} [detail]  the underlying error, appended when there is one --
 *   a generic apology is what made the last failure undiagnosable.
 */
export function describePushFailure(reason, detail) {
  const base = baseFailure(reason);
  return detail ? `${base} (${detail})` : base;
}

function baseFailure(reason) {
  switch (reason) {
    case "unsupported":
      return "This browser can't do notifications. On an iPhone, add Toolber to your home screen first.";
    case "not-configured":
      return "Notifications aren't set up on this deployment yet.";
    case "denied":
      return "Notifications are blocked for Toolber. You'll need to allow them in your browser's site settings — we can't ask again from here.";
    case "default":
      return "No answer to the permission prompt, so nothing changed.";
    case "subscribe-failed":
      return "The browser wouldn't create a subscription. A reload usually clears it.";
    case "save-failed":
      return "Couldn't save this device.";
    default:
      return "Couldn't turn on notifications.";
  }
}

// Remembers "not now" so the offer is not made after every single request.
const PROMPT_DISMISSED_KEY = "toolber:pushPromptDismissed";

// A "not now" is not a "never". This card is not the browser's prompt -- it
// costs nothing to decline and raises no permission dialog -- so treating one
// dismissal as permanent gave away the whole feature to a single reflexive
// tap. Asking again a fortnight later, twice more at most, is the difference
// between a reminder and nagging.
const PROMPT_COOLDOWN_DAYS = 14;
const PROMPT_MAX_OFFERS = 3;

/** How many times the soft prompt has been declined, and when it last was. */
function dismissalRecord() {
  try {
    const raw = window.localStorage.getItem(PROMPT_DISMISSED_KEY);
    if (!raw) return { count: 0, at: 0 };
    // "1" is what the original boolean version wrote. Read it as one
    // dismissal rather than discarding it, so nobody who already said no gets
    // asked again the moment this ships.
    if (raw === "1") return { count: 1, at: Date.now() };
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed?.count) || 0,
      at: Number(parsed?.at) || 0,
    };
  } catch {
    return { count: 0, at: 0 };
  }
}

/** Record that the soft prompt was declined on this device. */
export function dismissPushPrompt() {
  try {
    const { count } = dismissalRecord();
    window.localStorage.setItem(
      PROMPT_DISMISSED_KEY,
      JSON.stringify({ count: count + 1, at: Date.now() })
    );
  } catch {
    // Private browsing, or storage disabled. Worst case we offer once more.
  }
}

/**
 * Whether to offer push right now.
 *
 * Deliberately conservative, because the browser's permission prompt is a
 * one-shot: once dismissed, no script can ever raise it again, and the person
 * would have to find it in site settings. So the real prompt is only ever
 * triggered by someone tapping "Turn on" in our own card — never on page load,
 * and never twice.
 *
 * "default" is the only permission state worth asking in. "granted" needs
 * nothing, and "denied" cannot be undone from here.
 */
export async function shouldOfferPush() {
  if (!(await pushEligible())) return false;

  const { count, at } = dismissalRecord();
  if (count >= PROMPT_MAX_OFFERS) return false;
  if (count > 0 && Date.now() - at < PROMPT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return false;

  return true;
}

/**
 * Whether push is something this person could still turn on: the browser can
 * do it, we are configured for it, they have not already decided, and no
 * subscription is registered.
 *
 * Split out of shouldOfferPush because a passive row that says "push is off"
 * answers to eligibility alone, while interrupting someone with a dialog has
 * to answer to how often we have asked as well.
 */
export async function pushEligible() {
  if (!pushSupported() || !pushConfigured()) return false;
  // "granted" needs nothing, and "denied" cannot be undone from a page.
  if (permissionState() !== "default") return false;
  return !(await isRegistered());
}

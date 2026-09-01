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
    return { ok: false, reason: "save-failed" };
  }

  return { ok: true };
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

/** Human-readable reason for a failed enablePush(). */
export function describePushFailure(reason) {
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
      return "Couldn't save this device. Check your connection and try again.";
    default:
      return "Couldn't turn on notifications.";
  }
}

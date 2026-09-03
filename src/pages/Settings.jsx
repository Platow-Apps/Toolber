import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";
import Avatar from "../components/Avatar";
import { removeAvatar, uploadAvatar } from "../lib/avatars";
import { removeToolPhotos } from "../lib/photos";
import { EVENTS, logEvent } from "../lib/analytics";
import {
  describePushFailure,
  disablePush,
  enablePush,
  isRegistered,
  permissionState,
  pushConfigured,
  pushSupported,
} from "../lib/push";

export default function Settings() {
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [phone, setPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [sharing, setSharing] = useState({ share_email_on_approval: true, share_phone_on_approval: false, chest_public: true });
  const [sharingLoaded, setSharingLoaded] = useState(false);
  const [savingSharing, setSavingSharing] = useState(false);
  const [sharingError, setSharingError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [channels, setChannels] = useState({ email_enabled: true, push_enabled: true });
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsError, setChannelsError] = useState("");
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [permission, setPermission] = useState(() => permissionState());

  useEffect(() => {
    // Asks whether the *server* can reach this device, not merely whether the
    // browser holds a subscription. Those come apart: the browser is
    // subscribed the instant subscribe() resolves, which is before the row is
    // saved, so reading the browser's state showed "on" for a device we could
    // not actually send to. That is precisely how a failed registration went
    // unnoticed.
    let mounted = true;
    isRegistered().then((registered) => {
      if (mounted) setPushOn(registered);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function togglePush(next) {
    setPushBusy(true);
    setPushError("");
    const result = next ? await enablePush() : await disablePush();
    setPushBusy(false);
    setPermission(permissionState());
    if (result.ok) {
      setPushOn(next);
    } else {
      setPushError(describePushFailure(result.reason, result.detail));
      // Re-read rather than assume. A failed enable routinely leaves a browser
      // subscription behind with no row saved, and the switch must show
      // whether we can send — not whether the browser is willing to receive.
      setPushOn(await isRegistered());
    }
  }

  useEffect(() => {
    // phone is locked down like pickup_location — not in the general
    // profiles select grant, so reading even your own value back for this
    // field needs the dedicated RPC (see 0007_borrow_contact_reveal.sql).
    // No deps beyond mount: get_my_contact_info() reads auth.uid() server-side
    // rather than taking a param, and Settings fully remounts on session
    // change anyway (it's behind RequireAuth).
    supabase.rpc("get_my_contact_info").then(({ data }) => {
      setPhone(data?.[0]?.phone ?? "");
      setPhoneLoaded(true);
    });
  }, []);

  useEffect(() => {
    // Settings sits behind RequireAuth, but the provider resolves the session
    // asynchronously — this can run once before there is a user.
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("share_email_on_approval, share_phone_on_approval, chest_public")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setSharing(data);
        setSharingLoaded(true);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("notification_preferences")
      .select("email_enabled, push_enabled")
      .eq("profile_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setChannels(data);
        setChannelsLoaded(true);
      });
  }, [user?.id]);

  async function saveChannel(field, value) {
    // Optimistic, and reverted loudly on failure — see saveSharing below for
    // why silence here is the bug worth avoiding.
    const previous = channels;
    setChannels((prev) => ({ ...prev, [field]: value }));
    setChannelsError("");
    const { error } = await supabase
      .from("notification_preferences")
      .update({ [field]: value })
      .eq("profile_id", user.id);
    if (error) {
      setChannels(previous);
      setChannelsError(error.message);
    }
  }

  async function saveSharing(field, value) {
    // Optimistic: a checkbox that waits for a round trip feels broken.
    const previous = sharing;
    setSharing((prev) => ({ ...prev, [field]: value }));
    setSavingSharing(true);
    setSharingError("");
    const { error } = await supabase.from("profiles").update({ [field]: value }).eq("id", user.id);
    setSavingSharing(false);
    if (error) {
      // Reverting without saying why is what made a refused write look like a
      // stuck checkbox: it moved, the update failed, it moved back, and
      // nothing on screen accounted for it. These columns are column-grant
      // restricted (0009, 0039), so a permission error here is a real
      // possibility and not a hypothetical.
      setSharing(previous);
      setSharingError(error.message);
    }
  }

  // Seeded from the profile once it resolves, and not afterwards — re-seeding
  // on every profile change would wipe out whatever the person was mid-way
  // through typing when refreshProfile() lands.
  useEffect(() => {
    if (profile?.display_name) setDisplayName((prev) => prev || profile.display_name);
  }, [profile?.display_name]);

  async function saveDisplayName() {
    const next = displayName.trim();
    if (!next) return;
    setSavingName(true);
    setNameError("");
    setNameSaved(false);
    const { error } = await supabase.from("profiles").update({ display_name: next }).eq("id", user.id);
    setSavingName(false);
    if (error) {
      setNameError(error.message);
      return;
    }
    // The name is shown in the nav and on every tool this person lists, so the
    // whole app has to hear about it, not just this screen.
    await refreshProfile();
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function saveAvatar(file) {
    setSavingAvatar(true);
    setAvatarError("");
    const previous = profile?.avatar_url ?? null;
    try {
      const path = await uploadAvatar(user.id, file);
      const { error } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
      if (error) {
        // The row still points at the old picture, so the one just uploaded is
        // already orphaned. Clean it up rather than leave it in the bucket.
        await removeAvatar(path);
        setAvatarError(error.message);
        return;
      }
      await refreshProfile();
      // Only once the row points somewhere else — deleting first would leave a
      // gap where a failed update means no picture at all.
      await removeAvatar(previous);
    } catch (err) {
      setAvatarError(err.message ?? "Couldn't upload that image.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function clearAvatar() {
    setSavingAvatar(true);
    setAvatarError("");
    const previous = profile?.avatar_url ?? null;
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
    setSavingAvatar(false);
    if (error) {
      setAvatarError(error.message);
      return;
    }
    await refreshProfile();
    await removeAvatar(previous);
  }

  async function savePhone() {
    setSavingPhone(true);
    setPhoneSaved(false);
    const { error } = await supabase.from("profiles").update({ phone: phone.trim() || null }).eq("id", user.id);
    setSavingPhone(false);
    if (!error) {
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2000);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError("");
    // Guarded server-side: refuses while any borrow request is open, or while
    // this user administers a group that still has members (0032).
    const { data: photoPaths, error } = await supabase.rpc("delete_my_account");
    if (error) {
      setDeleting(false);
      setDeleteError(error.message);
      return;
    }
    // Logged before signing out -- the events insert policy requires
    // profile_id = auth.uid(), so it is rejected once the session is gone.
    await logEvent(user.id, EVENTS.ACCOUNT_DELETED, {});
    // profiles rows are scrubbed rather than deleted (0032), so the ON DELETE
    // CASCADE never fires -- without this, a deleted account's phone would
    // keep buzzing. Best-effort, like the photo cleanup below it.
    await disablePush().catch(() => {});
    // delete_my_account() nulls avatar_url but cannot reach Storage, so the
    // file would otherwise outlive the account that owned it.
    await removeAvatar(profile?.avatar_url);
    await supabase.rpc("delete_my_push_subscriptions");
    await removeToolPhotos(photoPaths);

    // Frees the email address so this person can sign up again later. Needs
    // the admin API, so it lives in an Edge Function, and it needs the
    // session -- hence before signOut. Best-effort on purpose: the account is
    // already deleted by this point, and failing here would strand someone on
    // a settings page for an account that no longer exists. Worst case the
    // address stays reserved, which is exactly the old behaviour.
    const { error: releaseErr } = await supabase.functions.invoke("release-account-email");
    if (releaseErr) console.warn("Could not release the email address:", releaseErr);

    await signOut();
  }

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
      </div>

      <div className="px-4 py-4">
        {/* Both of these were fixed at onboarding and never editable again.
            A display name is the only thing other neighbors see, and people
            change their minds about it — spelling, a surname they'd rather
            not publish, a nickname the group actually uses. */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <div className="mb-3 flex items-center gap-3">
            <Avatar
              path={profile?.avatar_url}
              name={profile?.display_name ?? user?.email}
              className="h-16 w-16 text-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-asphalt">{profile?.display_name ?? "Unnamed"}</p>
              <p className="mb-1.5 truncate text-xs text-muted">{user?.email}</p>

              <div className="flex flex-wrap items-center gap-2">
                {/* A file input styled as a button: the native control cannot
                    be restyled, and a bare "Choose file" next to a filename is
                    not what this row should look like. */}
                <label
                  className={`cursor-pointer rounded-lg border border-asphalt px-2.5 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt ${
                    savingAvatar ? "opacity-50" : ""
                  }`}
                >
                  {savingAvatar ? "Uploading…" : profile?.avatar_url ? "Change photo" : "Add photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={savingAvatar}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Cleared so picking the same file twice still fires a
                      // change event — otherwise a failed upload cannot be
                      // retried without choosing something else first.
                      e.target.value = "";
                      if (file) saveAvatar(file);
                    }}
                    className="hidden"
                  />
                </label>

                {profile?.avatar_url && (
                  <button
                    type="button"
                    onClick={clearAvatar}
                    disabled={savingAvatar}
                    className="rounded-lg border border-steelLight px-2.5 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-muted disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {avatarError && (
            <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2 text-[0.688rem] leading-relaxed text-signal">
              {avatarError}
            </p>
          )}

          <label htmlFor="settings-display-name" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Display name
          </label>
          <p className="mb-2 text-[0.688rem] leading-relaxed text-muted">
            What other neighbors see. It doesn't have to be your real name.
          </p>
          <div className="flex gap-1.5">
            <input
              id="settings-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jordan K."
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none"
            />
            <button
              type="button"
              onClick={saveDisplayName}
              aria-label="Save display name"
              disabled={savingName || !displayName.trim() || displayName.trim() === profile?.display_name}
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[0.688rem] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingName ? "…" : nameSaved ? "Saved" : "Save"}
            </button>
          </div>
          {nameError && <p className="mt-1.5 text-[0.688rem] leading-relaxed text-signal">{nameError}</p>}
        </div>

        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <label htmlFor="settings-phone" className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            Phone <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <p className="mb-2 text-[0.688rem] leading-relaxed text-muted">
            Only shared with a borrower or lender once you've approved a specific request with them — same rule as your pickup location.
          </p>
          <div className="flex gap-1.5">
            <input
              id="settings-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!phoneLoaded}
              placeholder="e.g. (555) 123-4567"
              className="w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={savePhone}
              aria-label="Save phone number"
              disabled={!phoneLoaded || savingPhone}
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[0.688rem] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingPhone ? "…" : phoneSaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* Approving a request used to disclose address, email and phone in
            one go. Each is now its own decision (0033). */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
            When you approve a request
          </p>
          <p className="mb-2.5 text-[0.688rem] leading-relaxed text-muted">
            Choose what the other person gets. You can always reach each other through messages, whatever
            you switch off here.
          </p>

          {sharingError && (
            <p className="mb-2 rounded-lg bg-[#FCEBEB] p-2 text-[0.688rem] leading-relaxed text-signal">
              Couldn't save that: {sharingError}
            </p>
          )}

          {[
            ["share_email_on_approval", "Share my email address"],
            ["share_phone_on_approval", "Share my phone number"],
          ].map(([field, label]) => (
            <label key={field} className="flex items-center justify-between py-1.5">
              <span className="pr-3 text-sm text-asphalt">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(sharing[field])}
                disabled={!sharingLoaded || savingSharing}
                onChange={(e) => saveSharing(field, e.target.checked)}
              />
            </label>
          ))}

          <p className="mt-1.5 text-[0.688rem] leading-relaxed text-muted">
            Whether your exact pickup address is shared is set per tool, on the listing itself.
          </p>
        </div>

        {/* Worded as advertising rather than hiding, deliberately. Switching
            this off does not make a tool private — every listing stays
            individually searchable, which is what makes the app work at all.
            Pausing a tool is how you actually withdraw one, and saying
            otherwise here would be a promise the schema doesn't keep. */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Your chest</p>
          <p className="mb-2.5 text-[0.688rem] leading-relaxed text-muted">
            Offer your tools together on one page, so a neighbor who finds one can see the rest.
          </p>
          <label className="flex items-center justify-between py-1.5">
            <span className="pr-3 text-sm text-asphalt">Show my tools as a collection</span>
            <input
              type="checkbox"
              checked={Boolean(sharing.chest_public)}
              disabled={!sharingLoaded || savingSharing}
              onChange={(e) => saveSharing("chest_public", e.target.checked)}
            />
          </label>
          <p className="mt-1.5 text-[0.688rem] leading-relaxed text-muted">
            Off just removes the shared page and the "more from this neighbor" link. Each tool is
            still findable on its own — to withdraw one, pause it from My Tools.
          </p>
        </div>

        {/* Email and push are separate switches because getting both for every
            single event is a lot of noise for one piece of news, and which one
            people want to keep differs. Deliberately at the channel level
            rather than per category: nine categories times two channels is
            eighteen toggles to express "email is too much". */}
        {channelsLoaded && (
          <div
            className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
            style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
          >
            <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              How you hear from us
            </p>
            <p className="mb-2.5 text-[0.688rem] leading-relaxed text-muted">
              Borrow requests, approvals, pickup spots and overdue reminders. Turn off whichever
              you don't want — the app's own notifications list keeps everything either way.
            </p>

            {channelsError && (
              <p className="mb-2 text-[0.688rem] leading-relaxed text-signal">{channelsError}</p>
            )}

            <label className="flex items-center justify-between border-b border-cardBorder py-2">
              <span className="pr-3 text-sm text-asphalt">Email</span>
              <input
                type="checkbox"
                checked={channels.email_enabled}
                onChange={(e) => saveChannel("email_enabled", e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between py-2">
              <span className="pr-3 text-sm text-asphalt">Push notifications</span>
              <input
                type="checkbox"
                checked={channels.push_enabled}
                onChange={(e) => saveChannel("push_enabled", e.target.checked)}
              />
            </label>
            <p className="mt-1.5 text-[0.688rem] leading-relaxed text-muted">
              Account and security email — password resets, address confirmations — is sent
              regardless.
            </p>
          </div>
        )}

        {/* Push is registered per browser, not per account, so this switch is
            about *this device* and sits under the account-level one above.
            Someone with a phone and a laptop turns it on twice, on purpose.
            Hidden when push is off for the account, because a device switch
            that changes nothing is worse than no switch at all. */}
        {channels.push_enabled && pushSupported() && pushConfigured() && (
          <div
            className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
            style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
          >
            <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-wide text-muted">
              Notifications on this device
            </p>
            <p className="mb-2.5 text-[0.688rem] leading-relaxed text-muted">
              Push has to be allowed once per browser. Turning it on here registers this one;
              your other devices are unaffected.
            </p>

            {pushError && <p className="mb-2 text-[0.688rem] leading-relaxed text-signal">{pushError}</p>}

            {permission === "denied" ? (
              <p className="text-[0.688rem] leading-relaxed text-ink">
                Notifications are blocked for Toolber in this browser. We can't ask again from
                here — you'd need to allow them in the browser's site settings.
              </p>
            ) : (
              <label className="flex items-center justify-between py-1.5">
                <span className="pr-3 text-sm text-asphalt">
                  {pushOn ? "On for this device" : "Off"}
                </span>
                <input
                  type="checkbox"
                  checked={pushOn}
                  disabled={pushBusy}
                  onChange={(e) => togglePush(e.target.checked)}
                />
              </label>
            )}
          </div>
        )}

        <p className="mb-4 text-xs leading-relaxed text-muted">
          Per-category notification preferences and Privacy &amp; Location controls are coming in a
          later build — for now your map pin uses the choice you made during setup.
        </p>

        <button
          type="button"
          onClick={signOut}
          className="w-full rounded-lg border border-redOrange/30 py-3 text-sm font-bold text-[#A34526]"
        >
          Sign out
        </button>

        {/* Two-step, and the confirm step spells out what survives. Deletion
            is irreversible and the honest description is not "everything
            disappears" — see delete_my_account() in 0032. */}
        <div className="mt-6 border-t border-cardBorder pt-5">
          <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wide text-muted">Delete account</p>

          {deleteError && (
            <p className="mb-2 rounded-lg bg-[#FCEBEB] p-2.5 text-sm text-signal">{deleteError}</p>
          )}

          {!confirmingDelete ? (
            <>
              <p className="mb-2.5 text-xs leading-relaxed text-muted">
                Removes your profile, your listings and their photos, your favorites and your group
                memberships. This can't be undone.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="w-full rounded-lg border border-signal/40 py-3 text-sm font-bold text-signal"
              >
                Delete my account
              </button>
            </>
          ) : (
            <>
              <p className="mb-2.5 text-xs leading-relaxed text-ink">
                <b>Delete your account permanently?</b> Your listings, photos, favorites and group
                memberships are removed, and your name and contact details are erased.
              </p>
              <p className="mb-3 text-xs leading-relaxed text-muted">
                Past borrow requests and conversations stay visible to the neighbor on the other side —
                that's their record too — but they'll no longer show who you were.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={deleting}
                  className="flex-1 rounded-lg bg-signal py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="flex-1 rounded-lg border border-steelLight py-3 text-sm font-bold text-ink disabled:opacity-50"
                >
                  Keep my account
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

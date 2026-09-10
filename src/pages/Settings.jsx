import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";
import Avatar from "../components/Avatar";
import { removeAvatar, uploadAvatar } from "../lib/avatars";
import { removeToolPhotos } from "../lib/photos";
import { pushNeedsInstall } from "../lib/install";
import { addressLine, DEFAULT_RADIUS_METERS, RADIUS_CHOICES, saveArea } from "../lib/location";
import { clearStoredOrigin } from "../lib/searchOrigin";
import { describePoint } from "../lib/geocode";
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
  // What is actually on the server, so Save can tell "edited" from "as loaded"
  // the way the display-name field does. Without it the button stayed lit
  // permanently and offered to save a value identical to the stored one.
  const [savedPhone, setSavedPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [sharing, setSharing] = useState({ share_email_on_approval: true, share_phone_on_approval: false, chest_public: true, show_own_tools: true });
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
  const [area, setArea] = useState({ street: "", city: "", state: "", zip: "" });
  const [areaRadius, setAreaRadius] = useState(DEFAULT_RADIUS_METERS);
  const [areaLabel, setAreaLabel] = useState(null);
  const [areaLabelLoading, setAreaLabelLoading] = useState(true);
  const [areaOpen, setAreaOpen] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [areaSaved, setAreaSaved] = useState(false);
  const [areaError, setAreaError] = useState("");
  // Both are choices about what a saved location is *for*, made at the moment
  // it is saved rather than as separate settings to go and find afterwards.
  const [useAsOrigin, setUseAsOrigin] = useState(true);
  const [saveAsPickup, setSaveAsPickup] = useState(false);
  // Re-asked on every change rather than remembered from onboarding: the
  // attestation is about the address being entered now.
  const [addressCertified, setAddressCertified] = useState(false);
  const [savedPickup, setSavedPickup] = useState("");

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

  /**
   * One switch, two jobs: register (or drop) this browser's subscription, and
   * set the account-level flag the Edge Function checks before sending.
   *
   * They were two checkboxes, and only this one appeared to do anything --
   * the account flag is read server-side, so flipping it changed nothing you
   * could see. Two controls for one intent, one of them apparently inert, is
   * worse than the multi-device precision it bought: switching push off on a
   * second device now silences push everywhere, which is what "push off"
   * plainly means and what almost everyone has one device to express.
   */
  async function togglePush(next) {
    setPushBusy(true);
    setPushError("");
    const result = next ? await enablePush() : await disablePush();
    setPushBusy(false);
    setPermission(permissionState());
    if (result.ok) {
      setPushOn(next);
      // Only after the subscription itself succeeded: a flag saying we may
      // send, with nothing registered to send to, describes nothing.
      await saveChannel("push_enabled", next);
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
      const stored = data?.[0]?.phone ?? "";
      setPhone(stored);
      setSavedPhone(stored);
      setPhoneLoaded(true);
    });
  }, []);

  useEffect(() => {
    // Settings sits behind RequireAuth, but the provider resolves the session
    // asynchronously — this can run once before there is a user.
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("share_email_on_approval, share_phone_on_approval, chest_public, show_own_tools")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        // Merged, not replaced. A row that came back without one of these
        // columns would otherwise wipe its default to undefined, and the
        // switch would render unchecked for a value that is actually true.
        if (data) setSharing((prev) => ({ ...prev, ...data }));
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

  useEffect(() => {
    // Radius only -- no coordinates come back from this. pin_radius_meters is
    // deliberately not readable for everyone (a radius published next to a
    // public pin bounds the real address to a disc of known size), so the
    // caller's own value comes through an RPC scoped to them (0045).
    supabase.rpc("get_my_default_pickup").then(({ data }) => {
      setSavedPickup(data ?? "");
    });
  }, []);

  useEffect(() => {
    supabase.rpc("get_my_area").then(({ data }) => {
      const radius = Number(data?.[0]?.radius_meters);
      if (Number.isFinite(radius) && radius > 0) setAreaRadius(radius);
    });
  }, []);

  useEffect(() => {
    // Named from the *approximate* point, not the real one. That point is
    // already public and already on the map, so naming it discloses nothing —
    // and home_lat/home_lng is unreadable from src/ by design anyway.
    let mounted = true;
    setAreaLabelLoading(true);
    describePoint(profile?.approx_lat, profile?.approx_lng).then((label) => {
      if (!mounted) return;
      setAreaLabel(label);
      setAreaLabelLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [profile?.approx_lat, profile?.approx_lng]);

  async function saveMyArea() {
    setSavingArea(true);
    setAreaError("");
    setAreaSaved(false);
    const result = await saveArea(addressLine(area), areaRadius, addressCertified);
    setSavingArea(false);
    if (!result.ok) {
      setAreaError(result.message);
      return;
    }
    // Saved only if they asked for it. The default is still to keep nothing:
    // 0045 geocodes the address, keeps the point and throws the words away,
    // and that remains what happens unless this is ticked.
    if (saveAsPickup) {
      const typed = addressLine(area);
      const { error: pickupError } = await supabase.rpc("set_my_default_pickup", {
        p_location: typed,
      });
      if (pickupError) {
        setSavingArea(false);
        setAreaError(pickupError.message);
        return;
      }
      setSavedPickup(typed);
    }

    // Forget any one-off place chosen in "Search near", so search measures
    // from the location just saved. Unticked, that choice stands -- someone
    // browsing another town should not be dragged home by editing an address.
    if (useAsOrigin) clearStoredOrigin();

    // The address itself is not kept unless asked for -- only the point it
    // produced, and the fuzzed point derived from that. Clearing the fields
    // says so plainly, and leaves nothing typed lying around on a shared
    // screen.
    setArea({ street: "", city: "", state: "", zip: "" });
    setAddressCertified(false);
    setAreaOpen(false);
    setAreaSaved(true);
    setTimeout(() => setAreaSaved(false), 4000);
    await logEvent(user.id, EVENTS.AREA_CHANGED, { radius_meters: areaRadius });
    // The map pin and every distance on Search read this off the profile.
    await refreshProfile();
  }

  async function forgetPickup() {
    const { error } = await supabase.rpc("set_my_default_pickup", { p_location: "" });
    if (error) {
      setAreaError(error.message);
      return;
    }
    setSavedPickup("");
  }

  async function savePhone() {
    const next = phone.trim();
    setSavingPhone(true);
    setPhoneSaved(false);
    setPhoneError("");
    const { error } = await supabase.from("profiles").update({ phone: next || null }).eq("id", user.id);
    setSavingPhone(false);
    if (error) {
      // phone is column-grant restricted like pickup_location, so a refused
      // write is a real possibility here -- and this used to swallow it,
      // leaving a Save button that did nothing and said nothing.
      setPhoneError(error.message);
      return;
    }
    setSavedPhone(next);
    setPhoneSaved(true);
    setTimeout(() => setPhoneSaved(false), 2000);
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
                  className={`cursor-pointer rounded-lg border border-asphalt px-2.5 py-1.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt ${
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
                    className="rounded-lg border border-steelLight px-2.5 py-1.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-muted disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {avatarError && (
            <p className="mb-3 rounded-lg bg-[#FCEBEB] p-2 text-[0.75rem] leading-relaxed text-signal">
              {avatarError}
            </p>
          )}

          <label htmlFor="settings-display-name" className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted">
            Display name
          </label>
          <p className="mb-2 text-[0.75rem] leading-relaxed text-muted">
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
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[0.75rem] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingName ? "…" : nameSaved ? "Saved" : "Save"}
            </button>
          </div>
          {nameError && <p className="mt-1.5 text-[0.75rem] leading-relaxed text-signal">{nameError}</p>}
        </div>

        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <label htmlFor="settings-phone" className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted">
            Phone <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <p className="mb-2 text-[0.75rem] leading-relaxed text-muted">
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
              disabled={!phoneLoaded || savingPhone || phone.trim() === savedPhone}
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[0.75rem] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingPhone ? "…" : phoneSaved ? "Saved" : "Save"}
            </button>
          </div>
          {phoneError && <p className="mt-1.5 text-[0.75rem] leading-relaxed text-signal">{phoneError}</p>}
        </div>

        {/* Set once at onboarding and never again, which made a move, a typo,
            or a wrong neighborhood unfixable from inside the app -- and this
            point is the origin for proximity search, for the map pin, and for
            Find a Group.

            Collapsed by default, and it does not show the saved address back:
            nothing stores one. Onboarding geocodes what you type, keeps the
            point, and throws the words away. Rendering a remembered address
            here would mean keeping it, for no purpose but this box. */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-muted">Your area</p>
          <p className="mb-2.5 text-[0.75rem] leading-relaxed text-muted">
            Where distances are measured from, and roughly where your pin sits. Your address is
            never shown to anyone and never stored — it becomes a random point nearby, once.
          </p>

          {areaSaved && (
            <p className="mb-2 rounded-lg bg-[#EAF6EC] p-2 text-[0.75rem] leading-relaxed text-asphalt">
              Saved. Your pin has moved to a new random point nearby.
            </p>
          )}

          {/* What it is now, not just a way to change it. The address is not
              stored, so this names the public pin's own surroundings — town
              and state only, since a neighborhood would describe a
              deliberately random point far more precisely than intended. */}
          <div className="mb-2.5 rounded-md bg-asphalt/5 p-2.5">
            {profile?.approx_lat == null ? (
              <p className="text-[0.75rem] text-muted">Not set yet.</p>
            ) : (
              <>
                <p className="text-[0.813rem] font-semibold leading-snug text-asphalt">
                  {areaLabelLoading ? "Locating…" : (areaLabel ?? "Set")}
                </p>
                {/* Not mono, not uppercase, and a size up from the muted text
                    around it. This line names a privacy setting, and it was
                    the hardest thing on the card to read — condensed uppercase
                    at 10px is the worst case for telling similar values
                    apart. */}
                <p className="mt-0.5 text-[0.813rem] leading-snug text-steelLight">
                  Pin lands within{" "}
                  <b className="font-semibold text-asphalt">
                    {RADIUS_CHOICES.find((c) => c.meters === areaRadius)?.label ?? `${areaRadius} m`}
                  </b>
                </p>
                {savedPickup && (
                  <p className="mt-1 text-[0.75rem] leading-snug text-muted">
                    Pickup address saved for new listings.{" "}
                    <button
                      type="button"
                      onClick={forgetPickup}
                      className="font-semibold text-racing underline"
                    >
                      Forget it
                    </button>
                  </p>
                )}
              </>
            )}
          </div>

          {!areaOpen ? (
            <button
              type="button"
              onClick={() => setAreaOpen(true)}
              className="w-full rounded-lg border border-steelLight py-2.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-asphalt"
            >
              Change my default location
            </button>
          ) : (
            <>
              <label className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted" htmlFor="area-street">
                Street
              </label>
              <input
                id="area-street"
                value={area.street}
                onChange={(e) => setArea((prev) => ({ ...prev, street: e.target.value }))}
                placeholder="123 Oak St"
                disabled={savingArea}
                className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none disabled:opacity-50"
              />
              <div className="flex gap-1.5">
                <div className="flex-1">
              <label className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted" htmlFor="area-city">
                City
              </label>
              <input
                id="area-city"
                value={area.city}
                onChange={(e) => setArea((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="Santa Rosa"
                disabled={savingArea}
                className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none disabled:opacity-50"
              />
                </div>
                <div className="w-20">
              <label className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted" htmlFor="area-state">
                State
              </label>
              <input
                id="area-state"
                value={area.state}
                onChange={(e) => setArea((prev) => ({ ...prev, state: e.target.value }))}
                placeholder="CA"
                disabled={savingArea}
                className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none disabled:opacity-50"
              />
                </div>
              </div>
              <label className="mb-1 block font-mono text-[0.75rem] uppercase tracking-wide text-muted" htmlFor="area-zip">
                ZIP
              </label>
              <input
                id="area-zip"
                value={area.zip}
                onChange={(e) => setArea((prev) => ({ ...prev, zip: e.target.value }))}
                placeholder="95404"
                disabled={savingArea}
                className="mb-2 w-full rounded-lg border border-cardBorder bg-white px-3 py-2.5 text-sm text-asphalt outline-none disabled:opacity-50"
              />

              {/* Radios rather than a select. Each option carries a
                  consequence as well as a distance, and a dropdown put both on
                  one truncating line at the smallest size on the screen — for
                  a choice about how findable your home is. */}
              <fieldset className="mb-2.5 mt-1">
                <legend className="mb-1.5 font-mono text-[0.75rem] uppercase tracking-wide text-muted">
                  How far your pin can land from you
                </legend>
                {RADIUS_CHOICES.map((choice) => (
                  <label
                    key={choice.meters}
                    className="mb-1 flex items-start gap-2 rounded-lg border border-cardBorder bg-white p-2.5"
                  >
                    <input
                      type="radio"
                      name="area-radius"
                      value={choice.meters}
                      checked={areaRadius === choice.meters}
                      onChange={() => setAreaRadius(choice.meters)}
                      disabled={savingArea}
                      className="mt-0.5"
                    />
                    <span className="text-[0.813rem] leading-snug text-asphalt">
                      {choice.label}
                      <span className="block text-[0.75rem] text-muted">{choice.note}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <label className="mb-1.5 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={useAsOrigin}
                  onChange={(e) => setUseAsOrigin(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[0.75rem] leading-snug text-asphalt">
                  Search from here
                  <span className="block text-[0.75rem] text-muted">
                    Clears any one-off place you picked in “Search near”.
                  </span>
                </span>
              </label>

              <label className="mb-2.5 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={saveAsPickup}
                  onChange={(e) => setSaveAsPickup(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[0.75rem] leading-snug text-asphalt">
                  Reuse this address when I list a tool
                  <span className="block text-[0.75rem] text-muted">
                    Saves the address itself, so you don't retype it per listing. Kept private and
                    shown to a borrower only after you approve them — same rule as any pickup spot.
                  </span>
                </span>
              </label>

              {/* Last of the three and the only required one, which is why it
                  says so. It was first, and unticked it disables Save — so
                  the two optional boxes above it read as the likely culprits
                  and nothing on screen corrected that. A required control
                  that silently holds a button shut is a puzzle, not a
                  safeguard. */}
              <label className="mb-2.5 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={addressCertified}
                  onChange={(e) => setAddressCertified(e.target.checked)}
                  aria-required="true"
                  className="mt-0.5"
                />
                <span className="text-[0.75rem] leading-snug text-asphalt">
                  <span className="text-signal">*</span> I confirm this is my home address and it's
                  correct
                  <span className="block text-[0.719rem] text-muted">
                    Required. Never shown to other members — they see a random point nearby. Shared
                    with someone only if you choose to.
                  </span>
                </span>
              </label>

              {areaError && (
                <p className="mb-2 rounded-lg bg-[#FCEBEB] p-2 text-[0.75rem] leading-relaxed text-signal">
                  {areaError}
                </p>
              )}

              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={saveMyArea}
                  disabled={
                    savingArea ||
                    !addressCertified ||
                    !area.street.trim() ||
                    !area.city.trim() ||
                    !area.state.trim()
                  }
                  className="flex-1 rounded-lg bg-asphalt py-2.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-safety disabled:opacity-40"
                >
                  {savingArea ? "Saving…" : "Save location"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAreaOpen(false);
                    setAreaError("");
                  }}
                  disabled={savingArea}
                  className="rounded-lg border border-steelLight px-3.5 py-2.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
                City and state matter — a street on its own is the usual reason an address can't be
                placed.
              </p>
            </>
          )}
        </div>

        {/* Approving a request used to disclose address, email and phone in
            one go. Each is now its own decision (0033). */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-muted">
            When you approve a request
          </p>
          <p className="mb-2.5 text-[0.75rem] leading-relaxed text-muted">
            Choose what the other person gets. You can always reach each other through messages, whatever
            you switch off here.
          </p>

          {sharingError && (
            <p className="mb-2 rounded-lg bg-[#FCEBEB] p-2 text-[0.75rem] leading-relaxed text-signal">
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

          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
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
          <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-muted">Your chest</p>
          <p className="mb-2.5 text-[0.75rem] leading-relaxed text-muted">
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
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
            Off just removes the shared page and the "more from this neighbor" link. Each tool is
            still findable on its own — to withdraw one, pause it from My Tools.
          </p>

          {/* A viewing preference, not a sharing one, which is why it sits
              apart from the switch above and says so: nobody else is affected
              by it. Kept on this device rather than on the profile for the
              same reason — it is about this screen, not this account.

              Also on the map itself, since that is where the clutter is
              noticed. Both write the same profile column (0051), so the two
              cannot disagree. */}
          <label className="mt-2.5 flex items-center justify-between border-t border-cardBorder py-1.5 pt-2.5">
            <span className="pr-3 text-sm text-asphalt">Show my own tools in search and on the map</span>
            <input
              type="checkbox"
              checked={Boolean(sharing.show_own_tools)}
              disabled={!sharingLoaded || savingSharing}
              onChange={(e) => saveSharing("show_own_tools", e.target.checked)}
            />
          </label>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
            Only changes what you see, on every device you sign in on. Your tools stay listed and
            findable by everyone else either way.
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
            <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-muted">
              How you hear from us
            </p>
            <p className="mb-2.5 text-[0.75rem] leading-relaxed text-muted">
              Borrow requests, approvals, pickup spots and overdue reminders. Turn off whichever
              you don't want — the app's own notifications list keeps everything either way.
            </p>

            {channelsError && (
              <p className="mb-2 text-[0.75rem] leading-relaxed text-signal">{channelsError}</p>
            )}

            <label className="flex items-center justify-between border-b border-cardBorder py-2">
              <span className="pr-3 text-sm text-asphalt">Email</span>
              <input
                type="checkbox"
                checked={channels.email_enabled}
                onChange={(e) => saveChannel("email_enabled", e.target.checked)}
              />
            </label>
            {/* Silence was the bug an iPhone found: Apple exposes the Push
                API only to a web app added to the Home Screen, so in any iOS
                browser tab the switch simply was not rendered — which reads
                as a missing feature rather than a missing step. Everywhere
                else, a browser without push is just that, and telling someone
                to install would not help. */}
            {!pushSupported() && pushNeedsInstall() && (
              <p className="py-2 text-[0.75rem] leading-relaxed text-ink">
                <b className="font-semibold text-asphalt">Push notifications on iPhone</b> need
                Toolber added to your Home Screen first — Apple only allows them for installed web
                apps. In Safari, tap Share, then Add to Home Screen, and open Toolber from there.
              </p>
            )}

            {pushSupported() && pushConfigured() && (
              permission === "denied" ? (
                <p className="py-2 text-[0.75rem] leading-relaxed text-ink">
                  <b className="font-semibold text-asphalt">Push notifications</b> are blocked for
                  Toolber in this browser. We can't ask again from here — you'd need to allow them
                  in the browser's site settings.
                </p>
              ) : (
                <label className="flex items-center justify-between py-2">
                  <span className="pr-3 text-sm text-asphalt">Push notifications</span>
                  <input
                    type="checkbox"
                    checked={pushOn}
                    disabled={pushBusy}
                    onChange={(e) => togglePush(e.target.checked)}
                  />
                </label>
              )
            )}

            {pushError && <p className="mt-1.5 text-[0.75rem] leading-relaxed text-signal">{pushError}</p>}

            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
              Account and security email — password resets, address confirmations — is sent
              regardless.
            </p>
          </div>
        )}

        {/* Replaced a note promising that Privacy & Location controls were
            "coming in a later build" — 0045 shipped them, and the paragraph
            had quietly become untrue. */}
        <div
          className="mb-4 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <p className="mb-1 font-mono text-[0.75rem] uppercase tracking-wide text-muted">Help</p>
          <Link to="/guide" className="block py-1.5 text-sm font-semibold text-racing">
            How Toolber works
          </Link>
          <p className="mb-1.5 text-[0.75rem] leading-relaxed text-muted">
            What neighbors can see about you, how handovers are arranged, and what's worth agreeing
            before you hand a tool over.
          </p>
          <div className="flex gap-4 border-t border-cardBorder pt-2">
            <Link to="/terms" className="text-[0.75rem] font-semibold text-steelLight">
              Terms of Service
            </Link>
            <Link to="/privacy" className="text-[0.75rem] font-semibold text-steelLight">
              Privacy Policy
            </Link>
          </div>
        </div>

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
          <p className="mb-2 font-mono text-[0.75rem] uppercase tracking-wide text-muted">Delete account</p>

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

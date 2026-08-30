import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";
import { removeToolPhotos } from "../lib/photos";
import { EVENTS, logEvent } from "../lib/analytics";

export default function Settings() {
  const { user, profile, signOut } = useAuth();

  const [phone, setPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
    await removeToolPhotos(photoPaths);
    await signOut();
  }

  return (
    <div>
      <div className="bg-asphalt px-4 pb-3.5 pt-4">
        <BrandBar />
      </div>

      <div className="px-4 py-4">
        <div
          className="mb-4 flex items-center gap-3 rounded-lg border border-cardBorder bg-white p-3.5"
          style={{ clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)" }}
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-asphalt text-lg font-bold text-safety">
            {(profile?.display_name ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-asphalt">{profile?.display_name ?? "Unnamed"}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
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
              disabled={!phoneLoaded || savingPhone}
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[0.688rem] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingPhone ? "…" : phoneSaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-muted">
          Notification preferences and Privacy &amp; Location controls are coming in a later build — for now
          your map pin uses the choice you made during setup.
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

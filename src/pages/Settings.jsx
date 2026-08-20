import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import BrandBar from "../components/BrandBar";

export default function Settings() {
  const { user, profile, signOut } = useAuth();

  const [phone, setPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);

  useEffect(() => {
    // phone is locked down like pickup_location — not in the general
    // profiles select grant, so reading even your own value back for this
    // field needs the dedicated RPC (see 0007_borrow_contact_reveal.sql).
    supabase.rpc("get_my_contact_info").then(({ data }) => {
      setPhone(data?.[0]?.phone ?? "");
      setPhoneLoaded(true);
    });
  }, [user.id]);

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
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">
            Phone <span className="normal-case text-[#B0AEA6]">(optional)</span>
          </label>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Only shared with a borrower or lender once you've approved a specific request with them — same rule as your pickup location.
          </p>
          <div className="flex gap-1.5">
            <input
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
              className="flex-shrink-0 rounded-lg bg-asphalt px-3.5 py-2.5 text-[11px] font-bold uppercase text-safety disabled:opacity-50"
            >
              {savingPhone ? "…" : phoneSaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-muted">
          Notifications, Privacy &amp; Location, and the rest of Settings aren't wired up yet — see
          toolber-settings.html, toolber-notifications.html, and toolber-privacy-location.html for the design.
        </p>

        <button
          type="button"
          onClick={signOut}
          className="w-full rounded-lg border border-redOrange/30 py-3 text-sm font-bold text-[#A34526]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

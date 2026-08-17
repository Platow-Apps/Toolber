import { useAuth } from "../contexts/AuthContext";
import BrandBar from "../components/BrandBar";

export default function Settings() {
  const { user, profile, signOut } = useAuth();

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

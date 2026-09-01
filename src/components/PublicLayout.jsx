import { Navigate, Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "../contexts/AuthContext";

// Unlike RequireAuth, this never redirects — Search is browsable by anyone.
// Every other tab (My Tools, Groups, Favorites, Settings) is still wrapped
// in RequireAuth individually, so tapping them naturally prompts sign-in.
//
// The app shell is a fixed-height flex column: scrolling happens inside the
// content row, and the nav is the last row rather than a fixed overlay. A
// screen can therefore claim the remaining height exactly (the map does), and
// `dvh` keeps that honest while a mobile browser's toolbars come and go.
//
// The content row is itself `flex flex-col`, which matters: a screen fills it
// with `grow`, not `min-h-full`. A percentage height inside a flex item does
// not reliably resolve (the item's height is only definite *after* layout), so
// `min-height: 100%` silently collapsed to the content height and the map came
// out a couple of hundred pixels tall.
export default function PublicLayout() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  // Confirming a signup email lands here, on Search, holding an account with
  // no display name and no map pin. Nothing on this screen said so, and every
  // tab the person tapped either bounced them to /login or did nothing — an
  // account in limbo with no indication of what to do next. Onboarding is the
  // only screen that can move them forward, so send them there, exactly as
  // RequireAuth already does for the signed-in tabs.
  //
  // Gated on `loading`: mid-restore the profile is legitimately null, and
  // redirecting on that would throw a signed-out visitor at the very wall this
  // layout exists to avoid.
  if (!loading && session && profile && !profile.profile_complete) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }

  return (
    <div className="flex h-app flex-col bg-page">
      <div className="app-content flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}

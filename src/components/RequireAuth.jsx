import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import BottomNav from "./BottomNav";

function LoadingScreen() {
  return (
    <div className="flex min-h-app items-center justify-center bg-page">
      <svg aria-hidden="true" className="h-6 w-6 animate-spin text-asphalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    </div>
  );
}

// Wraps every screen behind the bottom nav. Redirects to /login if signed out,
// and to /onboarding if signed in but profile_complete is still false — matching
// the "no silent fallback" location/ToS gate from docs/technical-design.md.
export default function RequireAuth() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profile && !profile.profile_complete && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // Same fixed-height shell as PublicLayout — see the note there.
  return (
    <div className="flex h-app flex-col bg-page">
      <div className="app-content flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}

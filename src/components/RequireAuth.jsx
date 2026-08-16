import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import BottomNav from "./BottomNav";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <svg className="h-6 w-6 animate-spin text-asphalt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

  return (
    <div className="min-h-screen bg-page pb-24">
      <Outlet />
      <BottomNav />
    </div>
  );
}

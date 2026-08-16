import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

// Lighter than RequireAuth — just needs a session, not a completed profile.
// Used for /onboarding itself, which is where profile_complete gets set.
export default function RequireSession() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

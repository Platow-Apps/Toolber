import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";

// Unlike RequireAuth, this never redirects — Search is browsable by anyone.
// Every other tab (My Tools, Groups, Favorites, Settings) is still wrapped
// in RequireAuth individually, so tapping them naturally prompts sign-in.
export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-page pb-24">
      <Outlet />
      <BottomNav />
    </div>
  );
}

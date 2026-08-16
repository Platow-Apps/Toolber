import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import RequireSession from "./components/RequireSession";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Onboarding from "./pages/Onboarding";
import Search from "./pages/Search";
import ToolDetail from "./pages/ToolDetail";
import MyTools from "./pages/MyTools";
import Groups from "./pages/Groups";
import Favorites from "./pages/Favorites";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<RequireSession />}>
        <Route path="/onboarding" element={<Onboarding />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/" element={<Search />} />
        <Route path="/tool/:id" element={<ToolDetail />} />
        <Route path="/my-tools" element={<MyTools />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

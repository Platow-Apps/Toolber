import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import RequireSession from "./components/RequireSession";
import PublicLayout from "./components/PublicLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Onboarding from "./pages/Onboarding";
import Search from "./pages/Search";
import ToolDetail from "./pages/ToolDetail";
import MyTools from "./pages/MyTools";
import ListTool from "./pages/ListTool";
import Groups from "./pages/Groups";
import CreateGroup from "./pages/CreateGroup";
import GroupDetail from "./pages/GroupDetail";
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

      <Route element={<PublicLayout />}>
        <Route path="/" element={<Search />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/tool/:id" element={<ToolDetail />} />
        <Route path="/my-tools" element={<MyTools />} />
        <Route path="/my-tools/new" element={<ListTool />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/new" element={<CreateGroup />} />
        <Route path="/groups/:id" element={<GroupDetail />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import RequireSession from "./components/RequireSession";
import PublicLayout from "./components/PublicLayout";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import ConfigError from "./pages/ConfigError";
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
import BorrowChat from "./pages/BorrowChat";
import Conversation from "./pages/Conversation";
import NotFound from "./pages/NotFound";

export default function App() {
  // Every screen talks to Supabase; with no configuration there is nothing to
  // render but an explanation.
  if (!isSupabaseConfigured) return <ConfigError />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<RequireSession />}>
        <Route path="/onboarding" element={<Onboarding />} />
      </Route>

      <Route element={<PublicLayout />}>
        <Route path="/" element={<Search />} />
        {/* Public alongside Search: a logged-out visitor who taps a result gets
            the tool, not a login wall. The pickup location is already gated by
            the RPC, and the request/favourite actions prompt sign-in. */}
        <Route path="/tool/:id" element={<ToolDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/my-tools" element={<MyTools />} />
        <Route path="/my-tools/new" element={<ListTool />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/new" element={<CreateGroup />} />
        <Route path="/groups/:id" element={<GroupDetail />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/settings" element={<Settings />} />
        {/* Always behind auth -- chat is only ever between the two specific
            signed-in parties of a conversation, never a public destination. */}
        <Route path="/requests/:id/chat" element={<BorrowChat />} />
        <Route path="/messages/:conversationId" element={<Conversation />} />
      </Route>
    </Routes>
  );
}

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

// Only the columns the client role is actually granted. Asking for home_lat /
// home_lng would fail the whole select on a column-privilege error and leave
// every screen without a profile — see docs/audit-2026-08-20.md.
const PROFILE_COLUMNS =
  "id, display_name, avatar_url, approx_lat, approx_lng, map_pin_hidden, profile_complete, is_platform_admin, theme_preference, deleted_at";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Failed to load profile", error);
      setProfile(null);
      return;
    }
    // A deleted account keeps its auth session until it expires, and deletion
    // sets profile_complete = false — which RequireAuth reads as "needs
    // onboarding" and would happily offer as a form to fill back in,
    // resurrecting the account. Sign out instead, wherever they landed.
    if (data?.deleted_at) {
      setProfile(null);
      await supabase.auth.signOut();
      return;
    }
    setProfile(data);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        setSession(session);
        if (session?.user?.id) {
          loadProfile(session.user.id).finally(() => {
            if (mounted) setLoading(false);
          });
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        // Offline, a bad VITE_SUPABASE_URL, or a CORS failure. Without this the
        // promise rejects, `loading` stays true, and RequireAuth spins forever.
        console.error("Failed to restore session", err);
        if (mounted) {
          setSession(null);
          setLoading(false);
        }
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSession(session);
      if (session?.user?.id) {
        // Deferred deliberately: supabase-js holds an internal auth lock across
        // this callback, and issuing another client call from inside it can
        // deadlock. Yielding to the task queue first releases the lock.
        const userId = session.user.id;
        setTimeout(() => {
          if (mounted) loadProfile(userId);
        }, 0);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session?.user?.id, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    refreshProfile,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

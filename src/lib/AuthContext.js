"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabaseClient";
import SignInScreen from "@/components/SignInScreen";

const AuthContext = createContext(null);

// Supabase hands over a brand-new user object on every token refresh (about
// hourly) and every time the tab comes back into view. Keep the existing
// one when it's the same person, so pages don't mistake that for a fresh
// sign-in and reload everything (which used to make a long lesson's newest
// work vanish from one person's screen).
function sameUser(prev, next) {
  if (!prev || !next) return next;
  return prev.id === next.id && prev.email === next.email ? prev : next;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  // Classroom Mode's student routes are public by design — students
  // never sign in (see ClassroomBoardViewer.js) — so this gate must not
  // apply to them, or a student never gets past the sign-in wall to
  // even reach the join/waiting/board-viewer screens.
  const isPublicRoute = pathname?.startsWith("/join");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const next = data.session?.user ?? null;
      setUser((prev) => sameUser(prev, next));
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser((prev) => sameUser(prev, next));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (isPublicRoute) {
    return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>;
  }

  if (loading || !user) {
    return <SignInScreen loading={loading} onSignIn={signInWithGoogle} />;
  }

  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

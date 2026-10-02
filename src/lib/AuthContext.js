"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabaseClient";
import { isDemoPath } from "./demoBackend";
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
  // The demo board (/demo) is public too: it needs no account at all.
  const isPublicRoute = pathname?.startsWith("/join") || isDemoPath(pathname);

  // The demo board uses a stand-in backend that is chosen when the page
  // loads. If someone moves between the demo and the real app without a
  // full page load, this tab would be left on the wrong one, so reload.
  // (At most once every few seconds, so it can never loop.)
  useEffect(() => {
    if (!pathname) return;
    if (Boolean(supabase.__demo) === isDemoPath(pathname)) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem("cleanslate_demo_reload")) || 0;
      sessionStorage.setItem("cleanslate_demo_reload", String(Date.now()));
    } catch (err) {}
    if (Date.now() - last > 5000) window.location.reload();
  }, [pathname]);

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

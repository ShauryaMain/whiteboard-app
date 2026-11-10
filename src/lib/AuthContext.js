"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabaseClient";
import { isDemoPath } from "./demoBackend";
import SignInScreen from "@/components/SignInScreen";
import { forgetTeacher, identifyTeacher, track } from "./track";
import { noteSignInStarted, takePendingSignIn } from "./signInNote";

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

// Students in a live class get an invisible sign-in (see liveMode.js): that
// isn't a teacher's account, so here it counts as signed out.
function teacherOf(session) {
  const u = session?.user ?? null;
  return u && !u.is_anonymous ? u : null;
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
  // A notebook opened from its link (/n/…) is public too: anyone can read
  // it. Writing on it (/n/…/write) needs an account, so that's not.
  // Joining a class (/c/…) and opening a notebook a teacher made for you
  // (/s/…) show what they are first, and sign in from there. So does a
  // board's own link (/b/…).
  const isPublicRoute =
    pathname?.startsWith("/join") || isDemoPath(pathname) || (pathname?.startsWith("/n/") && !pathname.endsWith("/write")) ||
    pathname?.startsWith("/c/") || pathname?.startsWith("/s/") || pathname?.startsWith("/b/");

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
      const next = teacherOf(data.session);
      setUser((prev) => sameUser(prev, next));
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = teacherOf(session);
      setUser((prev) => sameUser(prev, next));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Funnel counting (src/lib/track.js): a signed-in teacher is known by
  // their account id, and a sign-in that was just started (see
  // signInNote.js) is counted once it lands.
  useEffect(() => {
    if (loading || isDemoPath(pathname) || pathname?.startsWith("/join")) return;
    if (!user || !user.id) {
      // signed out (here, in another tab, or the session ran out): stop
      // counting this browser as the last teacher who used it
      forgetTeacher();
      return;
    }
    identifyTeacher(user.id);
    const pending = takePendingSignIn();
    if (pending) track("signed_in", pending);
  }, [user, loading, pathname]);

  async function signInWithGoogle() {
    noteSignInStarted("google", "signin_page");
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    forgetTeacher();
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

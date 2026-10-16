"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { isDemoPath } from "@/lib/demoBackend";
import { connectSettings, disconnectSettings } from "@/lib/settings";

// Keeps the teacher's settings (settings.js) in step with their account
// while they're signed in. Nothing to show.
export default function SettingsSync() {
  const auth = useAuth();
  const user = auth ? auth.user : null;
  const pathname = usePathname();
  const offAccount = isDemoPath(pathname) || (pathname || "").startsWith("/join");
  const userId = !offAccount && user && user.id ? user.id : null;

  useEffect(() => {
    if (!userId) {
      disconnectSettings();
      return undefined;
    }
    connectSettings(supabase, userId);
    // Back to this tab after a while: take in changes made on another
    // device meanwhile (at most once every half a minute).
    let last = Date.now();
    function onVisible() {
      if (document.visibilityState !== "visible" || Date.now() - last < 30000) return;
      last = Date.now();
      connectSettings(supabase, userId);
    }
    document.addEventListener("visibilitychange", onVisible);
    // signed out (or this page went away)
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      disconnectSettings();
    };
  }, [userId]);

  return null;
}

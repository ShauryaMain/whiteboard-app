"use client";

import { useEffect } from "react";
import { usePathname, useParams } from "next/navigation";
import { routeFor } from "./Analytics";
import { recordDemo, startTracking, trackPage } from "@/lib/track";

// Starts the funnel counting (src/lib/track.js) on pages where it's
// allowed, and notes each page opened. Does nothing without a PostHog key,
// and nothing at all on student pages.
export default function Tracking() {
  const pathname = usePathname();
  const params = useParams();
  const route = routeFor(pathname, params);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/join")) return;
    startTracking();
    trackPage(route);
    // screen recordings are for the demo board only
    recordDemo(/^\/demo(\/|$)/.test(pathname));
  }, [pathname, route]);

  return null;
}

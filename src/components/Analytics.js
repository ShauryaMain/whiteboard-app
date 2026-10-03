"use client";

import { useEffect } from "react";
import { usePathname, useParams } from "next/navigation";
import Script from "next/script";

// Counts page visits with Vercel Web Analytics: which pages get opened and
// which sites send people here. No cookies and nothing personal.
//
// It only does something once Web Analytics is switched on for this project
// in the Vercel dashboard (Analytics tab, then Enable). Until then the script
// below simply isn't there and nothing is counted.

const ON = process.env.NODE_ENV === "production";

// Private bits of an address are swapped for their placeholder, so a board
// opens as "/board/[id]" and a class as "/join/[code]". Board IDs and class
// codes never appear in the visit counts.
function routeFor(pathname, params) {
  let route = pathname || "/";
  for (const [key, value] of Object.entries(params || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v) route = route.replace(`/${v}`, `/[${key}]`);
    }
  }
  return route;
}

export default function Analytics() {
  const pathname = usePathname();
  const params = useParams();
  const route = routeFor(pathname, params);

  // One "page view" each time the address changes (the app moves between
  // pages without a full reload, so the script can't see this by itself).
  useEffect(() => {
    if (!ON) return;
    window.va =
      window.va ||
      function () {
        (window.vaq = window.vaq || []).push(arguments);
      };
    window.va("pageview", { route, path: route });
  }, [pathname, route]);

  if (!ON) return null;
  return (
    <Script
      src="/_vercel/insights/script.js"
      data-disable-auto-track="1"
      strategy="afterInteractive"
    />
  );
}

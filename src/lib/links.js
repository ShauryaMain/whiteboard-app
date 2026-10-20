// Where the Clean Slate logo links to: the public landing page (a separate
// site from the app). Set NEXT_PUBLIC_LANDING_URL in Vercel to change it,
// for example after moving to your own domain.
export const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "https://whiteboard-app-landing.vercel.app/";

// A landing page link that says where the visitor came from, e.g.
// landingLink("student-ended") or landingLink("teacher-share", "online-whiteboard-for-teaching").
// The landing site passes `ref` on to the app's buttons, and the app keeps
// it with the visitor's events (src/lib/track.js), so PostHog can show
// which link brought people.
export function landingLink(ref, page = "") {
  const base = LANDING_URL.endsWith("/") ? LANDING_URL : LANDING_URL + "/";
  return `${base}${page}?ref=${encodeURIComponent(ref)}`;
}

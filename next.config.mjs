/** @type {import('next').NextConfig} */

// Browser security rules sent with every page (see "Security headers" in
// claude/security-overhaul-status.md). They say which other sites the app
// may load things from or talk to, and stop other sites from putting the
// app inside a frame.

function origin(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch (err) {
    return null;
  }
}

const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseSocket = supabase ? supabase.replace(/^http/, "ws") : null;
const posthog = origin(process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com");
// PostHog loads its extra scripts (screen recording on the demo board) from
// its "assets" host: us.i.posthog.com -> us-assets.i.posthog.com
const posthogAssets = posthog ? posthog.replace(/^https:\/\/([a-z]+)\.i\.posthog\.com$/, "https://$1-assets.i.posthog.com") : null;
const google = "https://accounts.google.com";

const list = (...items) => items.filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js's own page scripts. 'unsafe-eval': the graph
  // plotter compiles equations into functions (compute-engine).
  `script-src ${list("'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", `${google}/gsi/client`, posthogAssets)}`,
  `style-src ${list("'self'", "'unsafe-inline'", "https://fonts.googleapis.com", `${google}/gsi/style`)}`,
  `font-src ${list("'self'", "data:", "blob:", "https://fonts.gstatic.com", supabase)}`,
  // pictures only from the app and its own storage (no tracking pictures)
  `img-src ${list("'self'", "data:", "blob:", supabase)}`,
  `media-src ${list("'self'", "data:", "blob:", supabase)}`,
  `connect-src ${list("'self'", "data:", "blob:", supabase, supabaseSocket, posthog, posthogAssets, `${google}/gsi/`, "https://fonts.googleapis.com", "https://fonts.gstatic.com")}`,
  "worker-src 'self' blob:",
  // simulations (PhET and others) and the Google sign-in button
  "frame-src https:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // nothing here uses the camera, microphone or location
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

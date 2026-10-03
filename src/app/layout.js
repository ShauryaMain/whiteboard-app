import "./globals.css";
import localFont from "next/font/local";
import Script from "next/script";
import { AuthProvider } from "@/lib/AuthContext";
import Analytics from "@/components/Analytics";

// Geist, bundled with the app (no request to Google at runtime or build
// time). One variable-weight file covers every weight the UI uses.
const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

// The landing page's notebook fonts, bundled the same way: Shantell Sans
// for headings (marker-pen style) and Caveat for handwritten notes.
const shantell = localFont({
  src: "./fonts/ShantellSans-Variable.woff2",
  variable: "--font-shantell",
  weight: "300 800",
  display: "swap",
});

const caveat = localFont({
  src: "./fonts/Caveat-Variable.woff2",
  variable: "--font-caveat",
  weight: "400 700",
  display: "swap",
});

export const metadata = {
  title: "Clean Slate",
  description:
    "Clean Slate is a free online whiteboard for teaching. Write with a stylus, keep the worksheet beside the board, and bring a whole class in with one code.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable} ${shantell.variable} ${caveat.variable}`}>
      <body>
        {/* Fills in a few browser features older iPads (iPadOS 15) lack,
            before any app code runs. No-op on modern browsers. */}
        <Script src="/legacy-polyfills.js" strategy="beforeInteractive" />
        <AuthProvider>{children}</AuthProvider>
        {/* Anonymous visit counts (Vercel Web Analytics). */}
        <Analytics />
      </body>
    </html>
  );
}

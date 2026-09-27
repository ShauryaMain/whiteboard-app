import "./globals.css";
import localFont from "next/font/local";
import Script from "next/script";
import { AuthProvider } from "@/lib/AuthContext";

// Geist, bundled with the app (no request to Google at runtime or build
// time). One variable-weight file covers every weight the UI uses.
const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

export const metadata = {
  title: "Whiteboard",
  description: "Shared whiteboard for tutoring sessions",
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
    <html lang="en" className={geist.variable}>
      <body>
        {/* Fills in a few browser features older iPads (iPadOS 15) lack,
            before any app code runs. No-op on modern browsers. */}
        <Script src="/legacy-polyfills.js" strategy="beforeInteractive" />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

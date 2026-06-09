import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "plan-sync",
  description: "A shared plan document for AI agents and humans.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "plan-sync",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

/**
 * Blocking no-FOUC theme bootstrap. Runs synchronously in the server-rendered
 * HTML before first paint so a manually-chosen theme is applied with zero
 * flash. Reads localStorage key `plansync:theme` (the exact key shared by
 * useTheme + useLastSeen's sibling). Only "dark"/"light" set the
 * documentElement.dataset.theme attribute that defeats the
 * prefers-color-scheme fallback; "auto", an absent key, or any thrown error
 * leaves the attribute unset so the system preference keeps winning.
 */
const NO_FOUC_THEME_SCRIPT = `try{var t=localStorage.getItem("plansync:theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-[100dvh] bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: NO_FOUC_THEME_SCRIPT }} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:border focus:border-border-strong focus:bg-surface focus:px-4 focus:py-2 focus:text-base focus:font-semibold focus:text-foreground focus:shadow-raised"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

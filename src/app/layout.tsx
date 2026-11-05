import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { themeBootScript } from "@/components/theme/theme-script";
import { parseThemeChoice } from "@/lib/theme";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-public-sans",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: "600",
  display: "swap",
  variable: "--font-source-serif",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: "500",
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: {
    default: "USC REC-DMS",
    template: "%s · REC-DMS",
  },
  description: "Research Ethics Committee document management for the University of San Carlos.",
  applicationName: "REC-DMS",
  icons: {
    icon: [
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/usc-seal-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const choice = parseThemeChoice(jar.get("theme")?.value);

  return (
    <html
      lang="en"
      data-theme-pref={choice}
      data-theme={choice === "system" ? undefined : choice}
      suppressHydrationWarning
      className={`${publicSans.variable} ${sourceSerif.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <Providers initialChoice={choice}>{children}</Providers>
      </body>
    </html>
  );
}

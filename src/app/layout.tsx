import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, M_PLUS_Rounded_1c } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ThemeSwitcher } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { withBasePath } from "@/lib/base-path";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const mplusRounded = M_PLUS_Rounded_1c({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "500",
});

const kyobo2019 = localFont({
  src: "../fonts/Kyobo Handwriting Font 2019.otf",
  variable: "--font-session",
  weight: "200 900",
  display: "swap",
});

const siteUrl =
  process.env.APP_BASE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Daily Set",
    template: "%s | Daily Set",
  },
  description: "운동 기록에 집중한 미니멀 웹앱",
  applicationName: "Daily Set",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Daily Set",
  },
  icons: {
    icon: [
      {
        url: withBasePath("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: withBasePath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: withBasePath("/apple-touch-icon.png"),
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link rel="manifest" href={withBasePath("/manifest.webmanifest")} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${mplusRounded.variable} ${kyobo2019.variable} antialiased`}
      >
        <ThemeSwitcher attribute="class">
          {children}
          <Toaster position="top-center" />
          <PwaInstallPrompt />
        </ThemeSwitcher>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

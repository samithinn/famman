import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const notoSansThai = localFont({
  src: "./fonts/NotoSansThai-Variable.ttf",
  variable: "--font-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FamMan",
  description: "Expenses and Incomes Tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FamMan",
  },
};

export const viewport: Viewport = {
  themeColor: "#c8b4f5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="cupcake" className={notoSansThai.variable}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Barlow_Semi_Condensed, Public_Sans } from "next/font/google";
import "./globals.css";

const body = Public_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ATGL Intelligence", template: "%s | ATGL Intelligence" },
  description: "Read-only energy and gas intelligence layer for Adani Total Gas: energy, gas and UAG, metering, reliability, billing, vendor and safety.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}

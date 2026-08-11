import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Web3Provider } from "@/components/wallet/Web3Provider";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "WitnessWeave — Turn real-world testimony into a living truth layer",
    template: "%s · WitnessWeave",
  },
  description:
    "WitnessWeave is a decentralized testimony marketplace: open a bounty, gather independent witness testimony and evidence, and let a GenLayer Intelligent Contract reach a verifiable, on-chain consensus.",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${jetbrainsMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background-deep text-text-primary font-[family-name:var(--font-geist-sans)]">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}

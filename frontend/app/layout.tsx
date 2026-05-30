import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CivicVox-Omni · Edge Emergency Intelligence",
  description: "Local-first multimodal emergency AI for the City of Toronto",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import Image from "next/image";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "Delation · Urban Risk Intelligence",
  description: "Local-first edge AI for the City of Toronto — powered by NVIDIA GB10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-gray-900 text-white">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <header style={{ position: "absolute", top: 10, left: 12, zIndex: 30, display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
            <Image
              src="/logo.png"
              alt="Delation"
              width={36}
              height={36}
              style={{ mixBlendMode: "screen", filter: "drop-shadow(0 0 4px rgba(59,130,246,0.6))" }}
            />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.08em", color: "#fff", fontFamily: "ui-monospace, monospace", textShadow: "0 0 10px rgba(59,130,246,0.5)" }}>
              DELATION
            </span>
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

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
          <header className="p-4">
            <Image
              src="/logo.png"
              alt="Logo"
              width={120}
              height={120}
            />
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

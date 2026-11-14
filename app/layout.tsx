import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeSite",
  description: "OSHA-focused worker safety platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

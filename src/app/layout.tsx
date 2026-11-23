import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkyFlow Assist",
  description: "A fictional airline rebooking demo with verified, deterministic booking rules.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OutBox",
  description: "AI-powered cold email scheduler",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

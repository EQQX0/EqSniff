import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Network Toolkit",
  description: "Own-network capture, filtering, and discovery — account and billing dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}

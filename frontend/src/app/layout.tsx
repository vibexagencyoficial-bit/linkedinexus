import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibexCorp — LinkedIn Outreach & Cadence SaaS",
  description: "Enterprise LinkedIn cadence automation, flow builder, and platform safety system.",
};

import { AuthProvider } from "@/lib/auth-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-[#090a0c] text-zinc-100 antialiased overflow-x-hidden font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

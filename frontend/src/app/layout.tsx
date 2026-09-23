import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibexCorp — LinkedIn Outreach & Cadence SaaS",
  description: "Enterprise LinkedIn cadence automation, flow builder, and platform safety system.",
};

import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";

// Anti-flash: aplica o tema salvo (padrão escuro) ANTES do primeiro paint.
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem("vibex_theme");
    if (t !== "light") { t = "dark"; }
    document.documentElement.classList.toggle("dark", t === "dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased overflow-x-hidden font-sans">
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

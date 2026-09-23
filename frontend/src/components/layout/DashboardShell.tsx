"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ContextualHeader } from "@/components/layout/ContextualHeader";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#f4f5fa]">
      <Sidebar mobileOpen={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ContextualHeader onMenuClick={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

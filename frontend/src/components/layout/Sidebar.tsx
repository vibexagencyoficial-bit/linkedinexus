"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Target,
  Users,
  Inbox,
  FileText,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  Puzzle,
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Campanhas", href: "/campaigns", icon: Target },
  { label: "Contatos", href: "/contacts", icon: Users },
  { label: "Inbox & Respostas", href: "/inbox", icon: Inbox },
  { label: "Templates", href: "/templates", icon: FileText },
  { label: "Atividade & Auditoria", href: "/activity", icon: Activity },
  { label: "Configurações", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`relative flex flex-col border-r border-zinc-800/80 bg-[#0c0d0f] transition-all duration-200 select-none ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      {/* Brand & Logo (Attio minimalist style) */}
      <div className="flex h-14 items-center justify-between px-3.5 border-b border-zinc-800/80">
        {!collapsed && (
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-tr from-zinc-100 to-zinc-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-sm">
              V
            </div>
            <div className="flex flex-col">
              <span className="font-semibold tracking-tight text-zinc-100 text-sm leading-tight">VibexCorp</span>
              <span className="text-[10px] text-zinc-500 font-mono">Outreach B2B</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto w-7 h-7 rounded-md bg-zinc-100 flex items-center justify-center font-bold text-zinc-950 text-xs">
            V
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition"
          aria-label="Toggle Sidebar"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? "bg-zinc-800/80 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-zinc-400"}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Extension & Architecture Indicator Footer */}
      <div className="p-3 border-t border-zinc-800/80 bg-[#090a0c]">
        {!collapsed ? (
          <div className="space-y-2">
            <Link
              href="/settings"
              className="flex items-center justify-between p-2 rounded-md border border-zinc-800/80 bg-[#141518] hover:border-zinc-700 transition"
            >
              <div className="flex items-center gap-2">
                <Puzzle className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-[11px] text-zinc-300 font-medium">Extensão WXT</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Pronta para pareamento" />
            </Link>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-1">
              <span>POSTGRES RLS</span>
              <span className="text-zinc-400">ACTIVE</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
        )}
      </div>
    </aside>
  );
}

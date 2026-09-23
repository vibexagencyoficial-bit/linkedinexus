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
  Search,
  LogOut,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

const NAV_GROUPS: { title: string; items: { label: string; href: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    title: "Geral",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Campanhas", href: "/campaigns", icon: Target },
      { label: "Contatos", href: "/contacts", icon: Users },
      { label: "Mensagens", href: "/inbox", icon: Inbox },
    ],
  },
  {
    title: "Ferramentas",
    items: [
      { label: "Templates", href: "/templates", icon: FileText },
      { label: "Atividade", href: "/activity", icon: Activity },
    ],
  },
  {
    title: "Suporte",
    items: [{ label: "Configurações", href: "/settings", icon: Settings }],
  },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Overlay do drawer no mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[#e8eaf1] bg-white transition-all duration-200 select-none lg:relative lg:z-auto lg:translate-x-0 dark:border-[#232b3d] dark:bg-[#10141f] ${
          collapsed ? "lg:w-[84px]" : "lg:w-[272px]"
        } w-[292px] ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Navegação principal"
      >
        {/* Marca */}
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-3" onClick={onClose}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-md shadow-indigo-600/25">
                V
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  VibexCorp
                </span>
                <span className="text-xs text-slate-400">Outreach B2B</span>
              </span>
            </Link>
          )}
          {collapsed && (
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-md shadow-indigo-600/25">
              V
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#f4f5fa] hover:text-slate-600 lg:flex dark:hover:bg-[#1a2132] dark:hover:text-slate-300"
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#f4f5fa] hover:text-slate-600 lg:hidden dark:hover:bg-[#1a2132] dark:hover:text-slate-300"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Busca da navegação */}
        <div className={`px-4 pb-3 ${collapsed ? "lg:hidden" : ""}`}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar..."
              className="w-full rounded-xl bg-[#f4f5fa] py-2.5 pl-9 pr-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:bg-[#0b0e17] dark:text-slate-200 dark:focus:bg-[#141a29] dark:focus:ring-indigo-500/30"
            />
          </div>
        </div>

        {/* Navegação em grupos */}
        <nav className="flex-1 overflow-y-auto px-4 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-5">
              {!collapsed && (
                <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                  {group.title}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                          : "text-slate-600 hover:bg-[#f4f5fa] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1a2132] dark:hover:text-slate-100"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-600 dark:bg-indigo-400" aria-hidden="true" />
                      )}
                      <Icon
                        className={`h-5 w-5 shrink-0 transition ${
                          isActive
                            ? "text-indigo-600 dark:text-indigo-300"
                            : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"
                        }`}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Rodapé: operador + encerrar sessão */}
        <div className={`border-t border-[#e8eaf1] p-4 dark:border-[#232b3d] ${collapsed ? "lg:px-2" : ""}`}>
          {!collapsed && (
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-[#f4f5fa] p-3 dark:bg-[#0b0e17]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                {user?.name ? user.name.charAt(0).toUpperCase() : "?"}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.name || "Operador"}
                </p>
                <p className="truncate text-xs text-slate-400">{user?.email || "sem sessão"}</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 ${
              collapsed ? "lg:justify-center" : ""
            }`}
            title={collapsed ? "Sair" : undefined}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

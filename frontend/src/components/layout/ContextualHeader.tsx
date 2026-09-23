"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Building2,
  Power,
  AlertTriangle,
  Menu,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { api } from "@/lib/api";
import { NotificationBell } from "@/components/layout/NotificationBell";

const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/campaigns/new", title: "Nova Campanha" },
  { prefix: "/campaigns", title: "Campanhas" },
  { prefix: "/contacts", title: "Contatos" },
  { prefix: "/inbox", title: "Mensagens" },
  { prefix: "/templates", title: "Templates" },
  { prefix: "/activity", title: "Atividade" },
  { prefix: "/settings", title: "Configurações" },
  { prefix: "/", title: "Dashboard" },
];

export function ContextualHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const pageTitle =
    PAGE_TITLES.find((entry) =>
      entry.prefix === "/" ? pathname === "/" : pathname.startsWith(entry.prefix)
    )?.title ?? "Dashboard";

  // Estado real do kill switch do servidor (o header é global; o valor
  // correto não pode depender de a pausa ter sido ativada nesta sessão).
  useEffect(() => {
    let cancelled = false;
    api
      .getDashboardMetrics()
      .then((m) => {
        if (!cancelled) setKillSwitchActive(Boolean(m.kill_switch_active));
      })
      .catch(() => {
        // Sem métricas (ex.: sem sessão), mantém o estado local honesto.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const handleToggleKillSwitch = async () => {
    const nextState = !killSwitchActive;
    await api.setGlobalKillSwitch(nextState).catch(() => null);
    setKillSwitchActive(nextState);
    setShowConfirmModal(false);
  };

  return (
    <>
      <header className="flex h-16 shrink-0 select-none items-center justify-between border-b border-[#e8eaf1] bg-white px-4 lg:px-6 dark:border-[#232b3d] dark:bg-[#10141f]">
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-[#f4f5fa] hover:text-slate-700 lg:hidden dark:text-slate-400 dark:hover:bg-[#1a2132] dark:hover:text-slate-200"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              {pageTitle}
            </h1>
            <p className="hidden text-xs text-slate-400 sm:block">
              Painel de outreach do LinkedIn
            </p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-2.5 py-1.5 text-xs font-medium text-slate-600 md:flex dark:border-[#232b3d] dark:bg-[#0b0e17] dark:text-slate-300">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold">VibexCorp</span>
            <span className="rounded bg-slate-200/70 px-1 font-mono text-[10px] text-slate-500 dark:bg-slate-500/20 dark:text-slate-400">
              RLS
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Alternância de tema (escuro ↔ claro) — no lugar da busca removida */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
            aria-label={theme === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e8eaf1] bg-white text-slate-500 transition hover:bg-[#f4f5fa] hover:text-slate-700 dark:border-[#232b3d] dark:bg-[#0b0e17] dark:text-slate-300 dark:hover:bg-[#1a2132]"
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>

          <NotificationBell />

          {/* Chave de segurança operacional */}
          <button
            onClick={() => setShowConfirmModal(true)}
            className={`flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition ${
              killSwitchActive
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30 dark:hover:bg-amber-500/20"
                : "bg-red-50 text-red-600 ring-1 ring-red-100 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/20"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {killSwitchActive ? "Envios pausados" : "Pausar envios"}
            </span>
          </button>

          {/* Perfil do usuário autenticado */}
          <div className="flex items-center gap-3 pl-1">
            <div className="hidden text-right leading-tight md:block">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                {user?.name || "Operador"}
              </span>
              <span className="block text-xs text-slate-400">{user?.email || "sem sessão"}</span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white ring-2 ring-indigo-100 dark:ring-indigo-500/30">
              {user?.name ? user.name.charAt(0).toUpperCase() : "?"}
            </div>
          </div>
        </div>
      </header>

      {/* Confirmação da chave de segurança */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#e8eaf1] bg-white p-6 text-slate-800 shadow-xl dark:border-[#232b3d] dark:bg-[#10141f] dark:text-slate-200">
            <div className="mb-4 flex items-center gap-3 text-red-600 dark:text-red-300">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold">
                {killSwitchActive ? "Retomar as operações de outreach?" : "Ativar a pausa global de envios?"}
              </h3>
            </div>
            <p className="mb-6 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {killSwitchActive
                ? "As campanhas em andamento serão retomadas e a fila voltará a despachar mensagens para os contatos elegíveis, respeitando os limites de segurança."
                : "Todas as campanhas em andamento serão pausadas imediatamente e nenhum novo job será despachado para as contas do LinkedIn."}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="rounded-xl border border-[#e8eaf1] px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-[#232b3d] dark:text-slate-300 dark:hover:bg-[#1a2132]"
              >
                Cancelar
              </button>
              <button
                onClick={handleToggleKillSwitch}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
                  killSwitchActive ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {killSwitchActive ? "Confirmar retomada" : "Confirmar pausa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

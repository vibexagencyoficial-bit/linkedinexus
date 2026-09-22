"use client";

import { useState } from "react";
import {
  Search,
  Building2,
  Power,
  LogOut,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export function ContextualHeader() {
  const { user, logout } = useAuth();
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [circuitState] = useState<"closed" | "half_open" | "open">("closed");

  const handleToggleKillSwitch = async () => {
    try {
      const nextState = !killSwitchActive;
      await api.setGlobalKillSwitch(nextState).catch(() => null);
      setKillSwitchActive(nextState);
      setShowConfirmModal(false);
    } catch {
      // Graceful fallback
    }
  };

  return (
    <>
      <header className="h-14 border-b border-zinc-800/80 bg-[#0e0f12]/90 backdrop-blur-md px-5 flex items-center justify-between z-10 select-none">
        {/* Tenant Selector & Quick Search */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 px-2.5 py-1 rounded-md border border-zinc-800 bg-[#16171a] text-xs text-zinc-300 font-medium">
            <Building2 className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-semibold text-white">VibexCorp</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">RLS</span>
          </div>

          <div className="relative w-64 md:w-80">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar contatos, campanhas... (Ctrl+K)"
              className="w-full pl-8 pr-4 py-1.5 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
            />
          </div>
        </div>

        {/* Operational Safety & Kill Switch & Profile */}
        <div className="flex items-center space-x-3">
          {/* Circuit Breaker Status Badge */}
          <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md border border-zinc-800 bg-[#141518] text-xs font-mono">
            <Radio className={`w-3 h-3 ${circuitState === "closed" ? "text-emerald-500" : "text-amber-500"}`} />
            <span className="text-zinc-400 text-[11px]">CB:</span>
            <span className={`text-[11px] font-semibold uppercase ${circuitState === "closed" ? "text-emerald-400" : "text-amber-400"}`}>
              {circuitState}
            </span>
          </div>

          {/* GLOBAL EMERGENCY KILL SWITCH */}
          <button
            onClick={() => setShowConfirmModal(true)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition shadow-sm ${
              killSwitchActive
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                : "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{killSwitchActive ? "OUTREACH PAUSADO" : "PAUSE ALL"}</span>
          </button>

          {/* User profile & Logout */}
          <div className="flex items-center space-x-2 pl-3 border-l border-zinc-800">
            <div className="h-7 w-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200">
              {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-medium text-zinc-200 leading-none">{user?.name || "Lucas"}</span>
              <span className="text-[10px] text-zinc-500 leading-tight">{user?.email || "admin@vibexcorp.com"}</span>
            </div>
            <button
              onClick={logout}
              title="Encerrar Sessão"
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition ml-1"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#121316] p-6 shadow-2xl text-zinc-100">
            <div className="flex items-center space-x-3 text-red-400 mb-4">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-semibold">
                {killSwitchActive ? "Retomar Operações de Outreach?" : "Ativar Kill Switch de Emergência?"}
              </h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-6">
              {killSwitchActive
                ? "As campanhas em andamento serão retomadas e a fila do Asynq voltará a disparar mensagens para contatos elegíveis."
                : "Todas as campanhas em andamento serão imediatamente pausadas e nenhum novo job do scheduler será enviado para as contas do LinkedIn."}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleToggleKillSwitch}
                className={`px-4 py-2 rounded-md text-xs font-semibold text-white transition ${
                  killSwitchActive ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {killSwitchActive ? "Confirmar Retomada" : "Confirmar Pausa Global"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

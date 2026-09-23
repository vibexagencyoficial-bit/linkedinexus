"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Linkedin,
  Check,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { ExtensionStatus, LinkedInAccount } from "@vibexcorp/api-client";
import { ExtensionSection } from "@/components/settings/ExtensionSection";

export default function SettingsPage() {
  const [dailyLimit, setDailyLimit] = useState(30);
  const [allowedStart, setAllowedStart] = useState("08:00");
  const [allowedEnd, setAllowedEnd] = useState("18:00");
  const [serverMaxLimit, setServerMaxLimit] = useState(50);
  const [serverMinLimit, setServerMinLimit] = useState(5);
  const [isSavingLimits, setIsSavingLimits] = useState(false);
  const [saved, setSaved] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  // LinkedIn Account state
  const [account, setAccount] = useState<LinkedInAccount | null>(null);
  const [isConnectingLi, setIsConnectingLi] = useState(false);
  const [liProfileName, setLiProfileName] = useState("");
  const [liSessionKey, setLiSessionKey] = useState("");
  const [showLiModal, setShowLiModal] = useState(false);
  // Erros reais da API (contrato honesto — nunca fabricar sucesso)
  const [accountError, setAccountError] = useState<string | null>(null);

  // Extension status (resumo no card de integrações; gestão completa na seção abaixo)
  const [extStatus, setExtStatus] = useState<ExtensionStatus | null>(null);

  const effectiveLimit = Math.min(Math.max(dailyLimit, serverMinLimit), serverMaxLimit);

  const loadData = async () => {
    // Contrato honesto: cada fonte registra seu erro real; nada é fabricado.
    const accRes = await api.getCurrentAccount().catch((err: unknown) => {
      setAccountError(err instanceof Error ? err.message : String(err));
      return null;
    });
    const extRes = await api.getExtensionStatus().catch(() => null);
    if (accRes) {
      setAccount(accRes);
      setAccountError(null);
    } else {
      setAccount(null);
    }
    setExtStatus(extRes);
  };

  // Limites vêm do backend (organizations.platform_settings) — o que aparece
  // na tela é o que está persistido, nunca um valor cosmético local.
  const loadLimits = async () => {
    try {
      const limits = await api.getDailyLimits();
      setDailyLimit(limits.daily_limit);
      setAllowedStart(limits.allowed_start_time);
      setAllowedEnd(limits.allowed_end_time);
      setServerMaxLimit(limits.server_max_limit);
      setServerMinLimit(limits.server_min_limit);
      setLimitsError(null);
    } catch (err: unknown) {
      setLimitsError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadData();
    loadLimits();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleQuickConnectLinkedIn = async () => {
    setIsConnectingLi(true);
    setAccountError(null);
    try {
      // Sem nome inventado: o backend usa o nome REAL do usuário autenticado.
      await api.connectAccount({});
      await loadData();
    } catch (err: unknown) {
      // Erro real chega à UI; badge permanece desconectado.
      setAccount(null);
      setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnectingLi(false);
    }
  };

  const handleConnectLinkedIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnectingLi(true);
    setAccountError(null);
    try {
      await api.connectAccount({
        display_name: liProfileName,
        session_key: liSessionKey || undefined,
      });
      setShowLiModal(false);
      await loadData();
    } catch (err: unknown) {
      // Erro real chega à UI (modal permanece aberto); sem conta fictícia.
      setAccount(null);
      setAccountError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnectingLi(false);
    }
  };

  const handleDisconnectLinkedIn = async () => {
    try {
      await api.disconnectAccount();
      await loadData();
    } catch (err: unknown) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveLimits = async () => {
    setIsSavingLimits(true);
    setLimitsError(null);
    try {
      await api.saveDailyLimits({
        daily_limit: effectiveLimit,
        allowed_start_time: allowedStart,
        allowed_end_time: allowedEnd,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await loadLimits();
    } catch (err: unknown) {
      // Sem API não há "Configurações salvas": o erro real substitui o sucesso.
      setSaved(false);
      setLimitsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingLimits(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Integrações: LinkedIn + resumo da extensão */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Conta LinkedIn */}
        <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <Linkedin className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Conta LinkedIn</h2>
                <p className="text-xs text-slate-400">Identidade corporativa dos envios com Stop on Reply.</p>
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                account?.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {account?.connected ? "CONECTADA" : "DESCONECTADA"}
            </span>
          </div>

          <div className="mt-4 rounded-xl bg-[#f4f5fa] p-3.5 text-xs leading-relaxed text-slate-500">
            <span className="mb-0.5 flex items-center gap-1.5 font-semibold text-slate-700">
              <ShieldAlert className="h-3.5 w-3.5 text-emerald-500" />
              Nunca digitamos sua senha do LinkedIn aqui.
            </span>
            O protocolo <strong>Zero-Evasion</strong> opera pela extensão Chrome no seu próprio navegador, aproveitando a
            sessão que você já tem aberta — sem checkpoints, sem 2FA forçado, sem bloqueio de IP.
          </div>

          {accountError && !account?.connected && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <span className="block font-semibold">Falha ao conectar a conta LinkedIn</span>
                <span className="break-all font-mono text-red-600/80">{accountError}</span>
              </div>
            </div>
          )}

          {account?.connected ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#f4f5fa] p-3">
                  <span className="block text-xs text-slate-400">Perfil conectado</span>
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {account.display_name || "Conta LinkedIn"}
                  </span>
                </div>
                <div className="rounded-xl bg-[#f4f5fa] p-3">
                  <span className="block text-xs text-slate-400">Limite operacional</span>
                  <span className="block text-sm font-semibold text-slate-800">
                    {account.daily_limit || 40} mensagens/dia
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> perfil · conexões · mensagens
                </span>
                <button
                  onClick={handleDisconnectLinkedIn}
                  className="rounded-lg border border-[#e8eaf1] px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={handleQuickConnectLinkedIn}
                disabled={isConnectingLi}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                {isConnectingLi ? "Conectando..." : "Conectar via Extensão (1 clique)"}
              </button>
              <button
                onClick={() => setShowLiModal(true)}
                className="rounded-lg border border-[#e8eaf1] px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Manual (cookie li_at)
              </button>
            </div>
          )}
        </div>

        {/* Limites diários e janela */}
        <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Limites diários &amp; janela de envio</h2>
              <p className="text-xs text-slate-400">Volume e horário permitidos para os disparos.</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              <ShieldCheck className="h-3 w-3" />
              Teto: {serverMaxLimit}/dia
            </span>
          </div>

          {limitsError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <span className="block font-semibold">Falha nos limites de envio</span>
                <span className="break-all font-mono text-red-600/80">{limitsError}</span>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium text-slate-600">Limite diário</span>
                <span className="font-bold text-slate-900">{dailyLimit} ações / dia</span>
              </div>
              <input
                type="range"
                min={serverMinLimit}
                max={serverMaxLimit}
                value={Math.min(dailyLimit, serverMaxLimit)}
                onChange={(e) => setDailyLimit(parseInt(e.target.value))}
                className="w-full accent-indigo-600"
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>Mínimo: {serverMinLimit}</span>
                <span className="font-semibold text-emerald-600">Efetivo: {effectiveLimit}</span>
                <span>Teto: {serverMaxLimit}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600">
                  <Clock className="h-4 w-4 text-slate-400" />
                  Início permitido
                </label>
                <input
                  type="time"
                  value={allowedStart}
                  onChange={(e) => setAllowedStart(e.target.value)}
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 font-mono text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600">
                  <Clock className="h-4 w-4 text-slate-400" />
                  Fim permitido
                </label>
                <input
                  type="time"
                  value={allowedEnd}
                  onChange={(e) => setAllowedEnd(e.target.value)}
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 font-mono text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveLimits}
                disabled={isSavingLimits}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {saved ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Configurações salvas</span>
                  </>
                ) : (
                  <span>{isSavingLimits ? "Salvando..." : "Salvar configurações"}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Extensão Chrome: gestão completa agora vive aqui */}
      <ExtensionSection />

      {/* Modal: Conectar LinkedIn */}
      {showLiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <Linkedin className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-base font-bold text-slate-900">Conectar conta do LinkedIn</h3>
                <p className="text-xs text-slate-400">Sem armazenamento de senha pura (Zero-Evasion).</p>
              </div>
            </div>

            <form onSubmit={handleConnectLinkedIn} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Nome de exibição / perfil</label>
                <input
                  type="text"
                  required
                  value={liProfileName}
                  onChange={(e) => setLiProfileName(e.target.value)}
                  placeholder="Lucas Silva"
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  Cookie de sessão (li_at) — opcional
                </label>
                <input
                  type="password"
                  value={liSessionKey}
                  onChange={(e) => setLiSessionKey(e.target.value)}
                  placeholder="Cole o cookie ou conecte direto via extensão"
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 font-mono text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:bg-white"
                />
                <span className="mt-1 block text-xs text-slate-400">
                  Se a extensão estiver pareada no navegador, a conta é autenticada automaticamente com 1 clique.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLiModal(false)}
                  className="rounded-lg border border-[#e8eaf1] px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isConnectingLi}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isConnectingLi ? "Conectando..." : "Conectar conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

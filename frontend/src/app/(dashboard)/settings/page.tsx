"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Linkedin,
  Puzzle,
  Check,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import { ExtensionStatus, LinkedInAccount } from "@vibexcorp/api-client";

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
  const [liProfileName, setLiProfileName] = useState("Lucas (LinkedIn)");
  const [liSessionKey, setLiSessionKey] = useState("");
  const [showLiModal, setShowLiModal] = useState(false);
  // Erros reais da API (A1: contrato honesto — nunca fabricar sucesso)
  const [accountError, setAccountError] = useState<string | null>(null);
  const [extError, setExtError] = useState<string | null>(null);

  // Extension status (resumo — gerenciamento completo fica em /extension)
  const [extStatus, setExtStatus] = useState<ExtensionStatus | null>(null);

  const effectiveLimit = Math.min(Math.max(dailyLimit, serverMinLimit), serverMaxLimit);

  const loadData = async () => {
    // A1 (contrato honesto): cada fonte registra seu erro real; nada é fabricado.
    const accRes = await api.getCurrentAccount().catch((err: unknown) => {
      setAccountError(err instanceof Error ? err.message : String(err));
      return null;
    });
    const extRes = await api.getExtensionStatus().catch((err: unknown) => {
      setExtError(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (accRes) {
      setAccount(accRes);
      setAccountError(null);
    } else {
      setAccount(null);
    }
    if (extRes) {
      setExtStatus(extRes);
      setExtError(null);
    } else {
      setExtStatus(null);
    }
  };

  // Limites vêm do backend (organizations.platform_settings; F1) — sem valor
  // cosmético local: o que aparece é o que está persistido.
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
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleQuickConnectLinkedIn = async () => {
    setIsConnectingLi(true);
    setAccountError(null);
    try {
      await api.connectAccount({
        display_name: "Lucas (LinkedIn Profile)",
      });
      await loadData();
    } catch (err: unknown) {
      // A1: erro real chega à UI; badge permanece NOT CONNECTED.
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
      // A1: erro real chega à UI (modal permanece aberto); sem conta fictícia.
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
      // Sem API não há "Configurações Salvas": o erro real substitui o sucesso.
      setSaved(false);
      setLimitsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingLimits(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Configurações & Integrações</h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Conecte sua conta do LinkedIn, acompanhe a extensão e defina os limites operacionais de cadência.
        </p>
      </div>

      {/* Integration Card: LinkedIn Account (Spec Section 7 & 8) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[#0077b5]/10 border border-[#0077b5]/30 flex items-center justify-center text-[#0077b5]">
              <Linkedin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Conta LinkedIn</h2>
              <p className="text-xs text-zinc-400">
                Identidade corporativa para disparos seguros de cadência e Stop on Reply.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-medium flex items-center gap-1.5 ${
                account?.connected
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}
            >
              {account?.connected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>CONNECTED</span>
                </>
              ) : (
                <span>NOT CONNECTED</span>
              )}
            </span>
            {account?.connected ? (
              <button
                onClick={handleDisconnectLinkedIn}
                className="px-3 py-1 rounded-md border border-zinc-700 bg-zinc-800/60 text-xs text-zinc-300 hover:text-white transition"
              >
                Desconectar
              </button>
            ) : (
              <button
                onClick={handleQuickConnectLinkedIn}
                disabled={isConnectingLi}
                className="px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm flex items-center gap-1.5"
              >
                <span>{isConnectingLi ? "Conectando..." : "Conectar LinkedIn (1 Clique)"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Security / Architecture explanation notice */}
        <div className="rounded-lg border border-zinc-800/60 bg-[#141518] p-3 text-xs text-zinc-400 flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-medium text-zinc-200 block">
              Não é necessário (nem recomendado) digitar sua senha do LinkedIn aqui.
            </span>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              O VibexCorp utiliza o protocolo seguro <strong>Zero-Evasion</strong>: a automação opera através da extensão Chrome conectada ao seu navegador, aproveitando a sessão que você já tem aberta no LinkedIn. Isso evita checkpoints de segurança, exigências de 2FA e bloqueios de IP.
            </p>
          </div>
        </div>

        {/* A1: erro real da conta (badge permanece NOT CONNECTED) */}
        {accountError && !account?.connected && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium block">Falha ao conectar a conta LinkedIn</span>
              <span className="text-[11px] text-red-300/80 font-mono break-all">
                {accountError}
              </span>
            </div>
          </div>
        )}

        {/* Connected account status details */}
        {account?.connected ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3 rounded-lg border border-zinc-800/80 bg-[#16171a]">
              <span className="text-[11px] text-zinc-500 block">Perfil Conectado</span>
              <span className="text-xs font-semibold text-white mt-0.5 block truncate">
                {account.display_name || "Lucas (LinkedIn Profile)"}
              </span>
            </div>
            <div className="p-3 rounded-lg border border-zinc-800/80 bg-[#16171a]">
              <span className="text-[11px] text-zinc-500 block">Limite Operacional</span>
              <span className="text-xs font-semibold text-white mt-0.5 block font-mono">
                {account.daily_limit || 40} mensagens/dia
              </span>
            </div>
            <div className="p-3 rounded-lg border border-zinc-800/80 bg-[#16171a]">
              <span className="text-[11px] text-zinc-500 block">Capacidades Autorizadas</span>
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-400 font-mono">
                <Check className="w-3 h-3" />
                <span>profile_read · connections · messaging</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-lg border border-dashed border-zinc-800 bg-[#141518]">
            <span className="text-xs text-zinc-400">
              Conecte sua conta do LinkedIn para habilitar disparos automáticos para suas conexões de 1º grau.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleQuickConnectLinkedIn}
                disabled={isConnectingLi}
                className="px-3 py-1.5 rounded-md bg-[#0077b5] hover:bg-[#0077b5]/90 text-xs font-medium text-white transition flex items-center gap-1.5 shadow-sm"
              >
                <Linkedin className="w-3.5 h-3.5" />
                <span>Conectar via Extensão</span>
              </button>
              <button
                onClick={() => setShowLiModal(true)}
                className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 hover:text-white transition"
              >
                Manual (Cookie li_at)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Extensão: linha-resumo — página dedicada em /extension */}
      <Link
        href="/extension"
        className="rounded-xl border border-zinc-800 bg-[#111215] p-4 flex items-center justify-between hover:border-zinc-700 transition group"
      >
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Puzzle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Extensão de Navegador</h2>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium flex items-center gap-1 ${
                  extStatus?.connected
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                }`}
              >
                {extStatus?.connected ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>CONNECTED</span>
                  </>
                ) : (
                  <span>OFFLINE</span>
                )}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {extError && !extStatus?.connected
                ? "Falha ao consultar o status — veja o erro na página da extensão."
                : "Download, pareamento e instalação passo a passo."}
            </p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400 group-hover:text-white transition flex-shrink-0">
          <span>Gerenciar</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </span>
      </Link>

      {/* Safety Policy & Limits Card (Spec Section 28 & 29) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Limites Diários & Janela de Execução</h2>
            <p className="text-xs text-zinc-400">Defina o volume diário e o horário permitido para envios.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-mono">
            <ShieldCheck className="w-3 h-3" />
            <span>Teto Backend: {serverMaxLimit} msg/dia</span>
          </div>
        </div>

        {/* Erro real dos limites (carregar ou salvar): sem sucesso fabricado */}
        {limitsError && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium block">Falha nos limites de envio</span>
              <span className="text-[11px] text-red-300/80 font-mono break-all">{limitsError}</span>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-300 font-medium">Limite Diário Desejado</span>
              <span className="font-mono text-white font-bold">{dailyLimit} ações / dia</span>
            </div>
            <input
              type="range"
              min={serverMinLimit}
              max={serverMaxLimit}
              value={Math.min(dailyLimit, serverMaxLimit)}
              onChange={(e) => setDailyLimit(parseInt(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[11px] text-zinc-500 mt-1 font-mono">
              <span>Mínimo: {serverMinLimit}</span>
              <span className="text-emerald-400">Efetivo: {effectiveLimit}</span>
              <span>Máximo do Servidor: {serverMaxLimit}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                <span>Horário Inicial Permitido</span>
              </label>
              <input
                type="time"
                value={allowedStart}
                onChange={(e) => setAllowedStart(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                <span>Horário Final Permitido</span>
              </label>
              <input
                type="time"
                value={allowedEnd}
                onChange={(e) => setAllowedEnd(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveLimits}
              disabled={isSavingLimits}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm disabled:opacity-60"
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Configurações Salvas</span>
                </>
              ) : (
                <span>{isSavingLimits ? "Salvando..." : "Salvar Configurações"}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Conectar LinkedIn */}
      {showLiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#121316] p-6 shadow-2xl text-zinc-100 space-y-4">
            <div className="flex items-center space-x-3 text-white">
              <div className="w-8 h-8 rounded-lg bg-[#0077b5]/10 border border-[#0077b5]/30 flex items-center justify-center text-[#0077b5]">
                <Linkedin className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Conectar Conta do LinkedIn</h3>
                <p className="text-xs text-zinc-400">Sem armazenamento de senha pura (Zero-Evasion).</p>
              </div>
            </div>

            <form onSubmit={handleConnectLinkedIn} className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Nome de Exibição / Perfil
                </label>
                <input
                  type="text"
                  required
                  value={liProfileName}
                  onChange={(e) => setLiProfileName(e.target.value)}
                  placeholder="Lucas Silva"
                  className="w-full px-3 py-2 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Cookie de Sessão (`li_at`) ou Token Autorizado (Opcional)
                </label>
                <input
                  type="password"
                  value={liSessionKey}
                  onChange={(e) => setLiSessionKey(e.target.value)}
                  placeholder="Cole o cookie li_at ou conecte diretamente via Extensão"
                  className="w-full px-3 py-2 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  Dica: Se a extensão estiver pareada no navegador, a conta é autenticada automaticamente com 1 clique.
                </span>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowLiModal(false)}
                  className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isConnectingLi}
                  className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {isConnectingLi ? "Conectando..." : "Conectar Conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

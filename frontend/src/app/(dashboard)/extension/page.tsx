"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Puzzle,
  Download,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  ShieldCheck,
  ExternalLink,
  Bot,
  Zap,
  Radio,
} from "lucide-react";
import { api, EXTENSION_DOWNLOAD_URL } from "@/lib/api";
import { ExtensionStatus } from "@vibexcorp/api-client";

// Página dedicada à extensão: status real, pareamento, download e instalação.
// Contrato honesto (A1): quando a API falha, o badge permanece OFFLINE e o
// erro real fica visível — nada de status fabricado.
export default function ExtensionPage() {
  const [extStatus, setExtStatus] = useState<ExtensionStatus | null>(null);
  const [extError, setExtError] = useState<string | null>(null);

  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiry, setPairingExpiry] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isGeneratingPairing, setIsGeneratingPairing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadStatus = useCallback(async () => {
    const extRes = await api.getExtensionStatus().catch((err: unknown) => {
      setExtError(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (extRes) {
      setExtStatus(extRes);
      setExtError(null);
    } else {
      setExtStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 3000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleGeneratePairing = async () => {
    setIsGeneratingPairing(true);
    setPairingError(null);
    try {
      const res = await api.generatePairingCode();
      setPairingCode(res.pairing_code);
      setPairingExpiry(new Date(res.expires_at).toLocaleTimeString());
      setPairingError(null);
    } catch (err: unknown) {
      // Sem API não há código — nunca gerar localmente (Math.random produziria
      // um código que nenhuma extensão poderia validar).
      setPairingCode(null);
      setPairingExpiry(null);
      setPairingError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingPairing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const steps = [
    { title: "Baixe a extensão", desc: "Clique em “Baixar Extensão (.zip)” e descompacte o arquivo em uma pasta do seu computador." },
    { title: "Abra o Chrome Interno", desc: "Na barra de endereço, digite chrome://extensions e pressione Enter." },
    { title: "Ative o Modo do Desenvolvedor", desc: "No canto superior direito da página, ligue a chave “Modo do desenvolvedor”." },
    { title: "Carregue a extensão", desc: "Clique em “Carregar sem compactação” e selecione a pasta descompactada do passo 1." },
    { title: "Pareie com o painel", desc: "Gere o código abaixo, clique no ícone da VibexCorp na barra do Chrome e cole o código." },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Extensão Chrome</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            A ponte entre o painel e o LinkedIn: envia as mensagens da campanha com automação que simula humanos.
          </p>
        </div>
        <span
          className={`flex-shrink-0 text-xs px-2.5 py-0.5 rounded-full font-mono font-medium flex items-center gap-1.5 ${
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

      {/* Download + instalação */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">VibexCorp Outreach (Chrome MV3)</h2>
              <p className="text-xs text-zinc-400">
                Instale no Chrome onde sua conta do LinkedIn está aberta.
              </p>
            </div>
          </div>
          <a
            href={EXTENSION_DOWNLOAD_URL}
            download="vibexcorp-extension.zip"
            className="flex-shrink-0 px-3.5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Baixar Extensão (.zip)</span>
          </a>
        </div>

        <ol className="space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300 mt-0.5">
                {i + 1}
              </span>
              <div>
                <span className="text-xs font-medium text-zinc-200 block">{step.title}</span>
                <span className="text-[11px] text-zinc-400 leading-relaxed">{step.desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Pareamento (movido de Configurações) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Pareamento do Navegador</h2>
              <p className="text-xs text-zinc-400">
                Vínculo único entre esta organização e o Chrome onde a extensão roda.
              </p>
            </div>
          </div>
          <button
            onClick={handleGeneratePairing}
            disabled={isGeneratingPairing}
            className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3 h-3 ${isGeneratingPairing ? "animate-spin" : ""}`} />
            <span>Gerar Código de Pareamento</span>
          </button>
        </div>

        {/* Erro real do status (badge permanece OFFLINE) */}
        {extError && !extStatus?.connected && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium block">Falha ao consultar a extensão</span>
              <span className="text-[11px] text-red-300/80 font-mono break-all">{extError}</span>
            </div>
          </div>
        )}

        {/* Erro real do pareamento (nenhum código local é gerado) */}
        {pairingError && !pairingCode && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium block">Falha ao gerar código de pareamento</span>
              <span className="text-[11px] text-red-300/80 font-mono break-all">{pairingError}</span>
            </div>
          </div>
        )}

        {pairingCode ? (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-indigo-300">
                Código de Pareamento Único (Válido por {pairingExpiry}):
              </span>
              <button
                onClick={() => copyToClipboard(pairingCode)}
                className="flex items-center gap-1 text-xs text-zinc-300 hover:text-white px-2 py-0.5 rounded bg-zinc-800"
              >
                {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCode ? "Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <div className="text-xl font-mono font-bold tracking-widest text-white text-center py-2 bg-[#090a0c] rounded border border-zinc-800">
              {pairingCode}
            </div>
            <p className="text-[11px] text-zinc-400">
              Abra o popup da extensão VibexCorp no Chrome e cole este código para vincular o navegador à sua organização.
            </p>
          </div>
        ) : extStatus?.connected ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3.5 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-emerald-300 block">
                  Extensão Ativa e Sincronizada
                </span>
                <span className="text-[11px] text-zinc-400 block mt-0.5">
                  Dispositivo: {extStatus.device_name || "VibexCorp Chrome Extension"} · Última atividade:{" "}
                  {extStatus.last_seen_at ? new Date(extStatus.last_seen_at).toLocaleTimeString() : "—"}
                </span>
              </div>
            </div>
            <button
              onClick={loadStatus}
              className="px-2.5 py-1 rounded text-[11px] border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition"
            >
              Atualizar
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800/60 bg-[#141518] p-3 text-xs text-zinc-400">
            Nenhum navegador pareado ainda. Gere um código e cole no popup da extensão (passo 5 da instalação).
          </div>
        )}
      </div>

      {/* Como funciona (pipeline real) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-3">
        <div className="flex items-center space-x-3 pb-3 border-b border-zinc-800/80">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Como a automação funciona</h2>
            <p className="text-xs text-zinc-400">Do clique no painel até a mensagem enviada — sem passos invisíveis.</p>
          </div>
        </div>
        <ol className="space-y-2 text-xs text-zinc-300 leading-relaxed">
          <li className="flex gap-2.5">
            <Zap className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong className="text-zinc-100">1. Painel ativa a campanha</strong> — os contatos entram na cadência e o
              backend enfileira as mensagens no horário permitido, respeitando o limite diário.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Radio className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong className="text-zinc-100">2. A extensão recebe a fila</strong> — o navegador pareado consulta a
              fila a cada poucos segundos e abre o perfil do contato no LinkedIn.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Bot className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong className="text-zinc-100">3. Automação que simula humanos</strong> — o assistente (Jev/Typesafe,
              via backend) define ritmo de cliques, cadência de digitação e pausas; a mensagem é digitada caractere a
              caractere na janela da conversa.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong className="text-zinc-100">4. Confirmação real</strong> — a entrega é reportada ao backend, a
              cadência avança para o próximo passo e falhas viram retry com até 3 tentativas.
            </span>
          </li>
        </ol>
        <p className="text-[11px] text-zinc-500 pt-1">
          A automação só roda com o Chrome aberto e a extensão pareada — e para imediatamente se você pausar pelo
          popup ou se o painel pausar a campanha.
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 transition"
        >
          <ExternalLink className="w-3 h-3" />
          <span>Limites diários e janela de envio ficam em Configurações</span>
        </Link>
      </div>
    </div>
  );
}

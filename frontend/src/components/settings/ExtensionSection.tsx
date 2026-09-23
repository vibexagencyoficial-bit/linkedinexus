"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Puzzle,
  Download,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  ShieldCheck,
  Bot,
  Zap,
  Radio,
} from "lucide-react";
import { api, EXTENSION_DOWNLOAD_URL } from "@/lib/api";
import { ExtensionStatus } from "@vibexcorp/api-client";

/**
 * Seção "Extensão Chrome" dentro de Configurações: status real (poll 3s),
 * pareamento pela API, download do zip e passo a passo. Contrato honesto:
 * API falhou = badge OFFLINE + erro visível, nada fabricado.
 */
export function ExtensionSection() {
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
      setPairingExpiry(new Date(res.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      setPairingError(null);
    } catch (err: unknown) {
      // Sem API não há código — nunca gerar localmente (um código fabricado
      // seria rejeitado pelo pareamento de qualquer extensão).
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
    {
      title: "Baixe a extensão",
      desc: "Clique em “Baixar Extensão (.zip)” e descompacte o arquivo em uma pasta do seu computador.",
    },
    {
      title: "Abra a página de extensões do Chrome",
      desc: "Na barra de endereço, digite chrome://extensions e pressione Enter.",
    },
    {
      title: "Ative o Modo do desenvolvedor",
      desc: "No canto superior direito da página, ligue a chave “Modo do desenvolvedor”.",
    },
    {
      title: "Carregue a extensão",
      desc: "Clique em “Carregar sem compactação” e selecione a pasta descompactada do passo 1.",
    },
    {
      title: "Pareie com o painel",
      desc: "Gere o código abaixo, clique no ícone da VibexCorp na barra do Chrome e cole o código.",
    },
  ];

  return (
    <div id="extensao" className="space-y-6 scroll-mt-24">
      {/* Download + instalação */}
      <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Puzzle className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">VibexCorp Outreach (Chrome MV3)</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                    extStatus?.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {extStatus?.connected ? "CONECTADA" : "OFFLINE"}
                </span>
              </div>
              <p className="text-xs text-slate-400">Instale no Chrome onde sua conta do LinkedIn está aberta.</p>
            </div>
          </div>
          <a
            href={EXTENSION_DOWNLOAD_URL}
            download="vibexcorp-extension.zip"
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            <Download className="h-4 w-4" />
            <span>Baixar Extensão (.zip)</span>
          </a>
        </div>

        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl bg-[#f4f5fa] p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-indigo-600 ring-1 ring-indigo-100">
                {i + 1}
              </span>
              <div>
                <span className="block text-sm font-semibold text-slate-800">{step.title}</span>
                <span className="text-xs leading-relaxed text-slate-500">{step.desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Pareamento */}
      <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Radio className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Pareamento do Navegador</h2>
              <p className="text-xs text-slate-400">Vínculo único entre esta organização e o Chrome da extensão.</p>
            </div>
          </div>
          <button
            onClick={handleGeneratePairing}
            disabled={isGeneratingPairing}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#e8eaf1] px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isGeneratingPairing ? "animate-spin" : ""}`} />
            <span>Gerar código de pareamento</span>
          </button>
        </div>

        {extError && !extStatus?.connected && (
          <div role="alert" className="mb-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="block font-semibold">Falha ao consultar a extensão</span>
                <span className="break-all font-mono text-xs text-red-600/80">{extError}</span>
              </div>
            </div>
          </div>
        )}

        {pairingError && !pairingCode && (
          <div role="alert" className="mb-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="block font-semibold">Falha ao gerar o código de pareamento</span>
                <span className="break-all font-mono text-xs text-red-600/80">{pairingError}</span>
              </div>
            </div>
          </div>
        )}

        {pairingCode ? (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-indigo-800">
                Código de pareamento único (válido até {pairingExpiry}):
              </span>
              <button
                onClick={() => copyToClipboard(pairingCode)}
                className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-[#e8eaf1] transition hover:bg-slate-50"
              >
                {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCode ? "Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <div className="mt-2 rounded-lg border border-indigo-100 bg-white py-3 text-center font-mono text-2xl font-bold tracking-[0.3em] text-slate-900">
              {pairingCode}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Abra o popup da extensão VibexCorp no Chrome e cole este código para vincular o navegador à sua organização.
            </p>
          </div>
        ) : extStatus?.connected ? (
          <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <span className="block text-sm font-semibold text-emerald-800">Extensão ativa e sincronizada</span>
                <span className="block text-xs text-slate-500">
                  Dispositivo: {extStatus.device_name || "VibexCorp Chrome Extension"} · Última atividade:{" "}
                  {extStatus.last_seen_at ? new Date(extStatus.last_seen_at).toLocaleTimeString("pt-BR") : "—"}
                </span>
              </div>
            </div>
            <button
              onClick={loadStatus}
              className="rounded-lg border border-[#e8eaf1] px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white"
            >
              Atualizar
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-[#f4f5fa] p-4 text-sm text-slate-500">
            Nenhum navegador pareado ainda. Gere um código e cole no popup da extensão (passo 5 da instalação).
          </div>
        )}
      </div>

      {/* Como funciona */}
      <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Como a automação funciona</h2>
            <p className="text-xs text-slate-400">Do clique no painel até a mensagem enviada, sem passos invisíveis.</p>
          </div>
        </div>
        <ol className="space-y-3 text-sm leading-relaxed text-slate-600">
          <li className="flex gap-2.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <span>
              <strong className="font-semibold text-slate-900">1. O painel ativa a campanha</strong> — os contatos entram
              na cadência e o backend enfileira as mensagens no horário permitido, respeitando o limite diário.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <span>
              <strong className="font-semibold text-slate-900">2. A extensão recebe a fila</strong> — o navegador pareado
              consulta a fila a cada poucos segundos e abre o perfil do contato no LinkedIn.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <span>
              <strong className="font-semibold text-slate-900">3. Automação com ritmo humano</strong> — o assistente
              (Jev/Typesafe, via backend) define o ritmo de cliques, a cadência de digitação e as pausas; a mensagem é
              digitada caractere a caractere na janela da conversa.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>
              <strong className="font-semibold text-slate-900">4. Confirmação real</strong> — a entrega é reportada ao
              backend, a cadência avança para o próximo passo e falhas viram tentativas de novo (até 3).
            </span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-400">
          A automação só roda com o Chrome aberto e a extensão pareada — e para imediatamente se você pausar pelo popup
          ou se o painel pausar a campanha.
        </p>
      </div>
    </div>
  );
}

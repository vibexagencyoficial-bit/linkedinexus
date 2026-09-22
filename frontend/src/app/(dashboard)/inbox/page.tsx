"use client";

import { useEffect, useState } from "react";
import {
  Search,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  Send,
  User,
  ExternalLink,
  Clock,
  Sparkles,
  Inbox as InboxIcon,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { ConversationItem } from "@vibexcorp/api-client";

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSimulatingReply, setIsSimulatingReply] = useState(false);

  const loadConversations = async () => {
    try {
      const res = await api.listConversations();
      if (res.conversations) {
        setConversations(res.conversations);
      }
    } catch {
      // Ignora erro transitório
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.leadName.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    );
  });

  const activeConv =
    conversations.find((c) => c.id === selectedId) ||
    filteredConversations[0] ||
    conversations[0] ||
    null;

  const handleSimulateReply = async () => {
    if (!activeConv) return;
    setIsSimulatingReply(true);
    try {
      await api.reportReply(
        activeConv.id,
        activeConv.leadName,
        "Olá! Agradeço pelo contato. Vamos sim agendar um call para conversar sobre as soluções da sua empresa!"
      );
      await loadConversations();
    } catch (err: any) {
      alert("Erro ao simular resposta: " + err.message);
    } finally {
      setIsSimulatingReply(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/80 gap-3">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-bold text-white tracking-tight">Inbox & Mensagens do LinkedIn</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono font-medium">
              Zero-Evasion Mode
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Visibilidade unificada das mensagens enviadas pela extensão no LinkedIn e detecção em tempo real de Stop on Reply.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadConversations}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-800 bg-[#16171a] hover:bg-zinc-800 text-xs text-zinc-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
            <span>Atualizar</span>
          </button>
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-800 bg-[#16171a] text-xs text-zinc-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Stop on Reply Ativo</span>
          </div>
        </div>
      </div>

      {/* Main Inbox Studio Workspace (Attio Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-hidden">
        {/* Left: Conversation List (4 cols) */}
        <div className="lg:col-span-4 rounded-xl border border-zinc-800 bg-[#111215] flex flex-col overflow-hidden">
          <div className="p-3 border-b border-zinc-800">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Buscar conversas por nome, empresa ou mensagem..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              /* Attio-Style Clean Empty State */
              <div className="p-8 text-center space-y-2 text-zinc-500">
                <InboxIcon className="w-6 h-6 mx-auto text-zinc-600" />
                <span className="text-xs font-medium text-zinc-400 block">Nenhuma conversa registrada</span>
                <p className="text-[11px] leading-relaxed max-w-xs mx-auto">
                  Assim que a extensão disparar mensagens para suas conexões do LinkedIn, o histórico de cada contato aparecerá aqui em tempo real.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`p-3.5 cursor-pointer transition ${
                      activeConv?.id === conv.id
                        ? "bg-zinc-800/70 border-l-2 border-indigo-500"
                        : "hover:bg-zinc-800/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-white truncate">{conv.leadName}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{conv.lastMessageTime}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] text-zinc-400 block truncate">
                        {conv.jobTitle} · {conv.company}
                      </span>
                      {conv.hasReplied && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                          Respondeu
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-300 line-clamp-1 leading-snug">{conv.lastMessage}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Message Thread & Stop on Reply Banner (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border border-zinc-800 bg-[#0e0f12] flex flex-col overflow-hidden">
          {activeConv ? (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-zinc-800/80 bg-[#121316] flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">{activeConv.leadName}</h2>
                    {activeConv.hasReplied ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                        ✓ STOP ON REPLY ATIVADO
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                        AGUARDANDO RESPOSTA
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400">
                    {activeConv.jobTitle} · {activeConv.company}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSimulateReply}
                    disabled={isSimulatingReply || activeConv.hasReplied}
                    className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-medium transition disabled:opacity-40"
                    title="Simula uma resposta deste contato para testar o Stop on Reply automático"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{activeConv.hasReplied ? "Resposta Registrada" : "Testar Stop on Reply"}</span>
                  </button>

                  {activeConv.linkedinUrl && (
                    <a
                      href={activeConv.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200 text-[11px] transition"
                    >
                      <span>Abrir no LinkedIn</span>
                      <ExternalLink className="w-3 h-3 text-zinc-400" />
                    </a>
                  )}
                </div>
              </div>

              {/* Stop on Reply Banner if replied */}
              {activeConv.hasReplied && (
                <div className="p-3 bg-emerald-950/40 border-b border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>
                      <b>Stop on Reply executado:</b> Este contato respondeu no LinkedIn. Todos os próximos follow-ups foram cancelados automaticamente para preservar o relacionamento.
                    </span>
                  </div>
                </div>
              )}

              {/* Messages Scroll Area */}
              <div className="flex-1 p-5 overflow-y-auto space-y-4">
                {activeConv.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.direction === "outbound" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] text-zinc-500 font-mono">
                      <span>{msg.direction === "outbound" ? "Enviado por você (Extensão)" : activeConv.leadName}</span>
                      <span>·</span>
                      <span>{msg.sentAt}</span>
                    </div>

                    <div
                      className={`max-w-lg p-3.5 rounded-xl text-xs leading-relaxed ${
                        msg.direction === "outbound"
                          ? "bg-indigo-600/90 text-white rounded-br-none shadow-sm"
                          : "bg-zinc-800/90 text-zinc-100 rounded-bl-none border border-zinc-700/60 shadow-sm"
                      }`}
                    >
                      <p className="whitespace-pre-line">{msg.content}</p>
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
                      {msg.stepTag && (
                        <span className="font-mono text-[9px] text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                          {msg.stepTag}
                        </span>
                      )}
                      {msg.direction === "outbound" && (
                        <span className="text-indigo-400 text-[10px] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Entregue via LinkedIn</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Inbox Integrada do LinkedIn</h3>
                <p className="text-xs text-zinc-400 max-w-sm mt-1">
                  Selecione uma conversa ao lado para acompanhar o histórico de mensagens enviadas e gerenciar as respostas com Stop on Reply automático.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

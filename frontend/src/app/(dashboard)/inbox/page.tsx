"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  Inbox as InboxIcon,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLiveEvents } from "@/lib/sse";
import { ConversationItem, ConversationMessage } from "@vibexcorp/api-client";

export default function InboxPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSimulatingReply, setIsSimulatingReply] = useState(false);
  const [thread, setThread] = useState<ConversationMessage[]>([]);

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

  // Thread REAL da conversa (a lista vem sem mensagens por design —
  // carregar a thread aqui; sem isso o painel nunca mostrava as mensagens).
  const loadThread = async (convId: string) => {
    try {
      const conv = await api.getConversation(convId);
      setThread(conv.messages ?? []);
    } catch {
      setThread([]);
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 3000);
    return () => clearInterval(interval);
  }, []);

  // AO VIVO: novo disparo/resposta atualiza lista e thread na hora (SSE).
  useLiveEvents(token, (type) => {
    if (type === "message.sent" || type === "message.queued" || type === "reply.detected") {
      loadConversations();
      if (activeConvIdRef.current) loadThread(activeConvIdRef.current);
    }
  });

  const activeConvIdRef = useRef<string | null>(null);

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

  // Carrega a thread quando a conversa ativa muda (ou chega mensagem nova).
  useEffect(() => {
    activeConvIdRef.current = activeConv?.id ?? null;
    if (activeConv?.id) {
      loadThread(activeConv.id);
    } else {
      setThread([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id, activeConv?.lastMessage]);

  const handleSimulateReply = async () => {
    if (!activeConv) return;
    setIsSimulatingReply(true);
    try {
      // Stop on Reply espera contact_id (o backend atualiza o contato) —
      // antes passava o id da conversa e recebia 404 sempre.
      await api.reportReply(
        activeConv.contact_id ?? activeConv.id,
        activeConv.leadName,
        "Olá! Agradeço pelo contato. Vamos sim agendar um call para conversar sobre as soluções da sua empresa!"
      );
      await loadConversations();
      if (activeConv.id) await loadThread(activeConv.id);
    } catch (err: unknown) {
      alert("Erro ao simular resposta: " + (err instanceof Error ? err.message : ""));
    } finally {
      setIsSimulatingReply(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col justify-between gap-3 border-b border-[#eef0f6] pb-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              Mensagens do LinkedIn
            </h2>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Stop on Reply ativo
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            Visibilidade unificada das mensagens enviadas pela extensão no LinkedIn e detecção em tempo real de respostas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadConversations}
            className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4 text-slate-400" />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Área principal da inbox */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
        {/* Esquerda: lista de conversas */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#e8eaf1] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-4">
          <div className="border-b border-[#eef0f6] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por nome, empresa ou mensagem..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="space-y-2 p-8 text-center text-slate-500">
                <InboxIcon className="mx-auto h-7 w-7 text-slate-300" />
                <span className="block text-sm font-medium text-slate-600">
                  Nenhuma conversa registrada
                </span>
                <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
                  Assim que a extensão disparar mensagens para suas conexões do LinkedIn, o histórico de cada contato aparecerá aqui em tempo real.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#eef0f6]">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`cursor-pointer p-3.5 transition ${
                      activeConv?.id === conv.id
                        ? "border-l-2 border-indigo-500 bg-indigo-50/60"
                        : "border-l-2 border-transparent hover:bg-[#f8f9fc]"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate text-sm font-semibold text-slate-900">{conv.leadName}</span>
                      <span className="font-mono text-xs text-slate-400">{conv.lastMessageTime}</span>
                    </div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="block truncate text-xs text-slate-500">
                        {conv.jobTitle} · {conv.company}
                      </span>
                      {conv.hasReplied && (
                        <span className="flex-shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                          Respondeu
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-1 text-sm leading-snug text-slate-600">{conv.lastMessage}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Direita: thread e banner de Stop on Reply */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#e8eaf1] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-8">
          {activeConv ? (
            <>
              {/* Cabeçalho da thread */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0f6] bg-[#f8f9fc] p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{activeConv.leadName}</h3>
                    {activeConv.hasReplied ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        Stop on Reply ativado
                      </span>
                    ) : (
                      <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                        Aguardando resposta
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-slate-500">
                    {activeConv.jobTitle} · {activeConv.company}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSimulateReply}
                    disabled={isSimulatingReply || activeConv.hasReplied}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
                    title="Simula uma resposta deste contato para testar o Stop on Reply automático"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{activeConv.hasReplied ? "Resposta registrada" : "Testar Stop on Reply"}</span>
                  </button>

                  {activeConv.linkedinUrl && (
                    <a
                      href={activeConv.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-[#e8eaf1] bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      <span>Abrir no LinkedIn</span>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  )}
                </div>
              </div>

              {/* Banner de Stop on Reply quando respondeu */}
              {activeConv.hasReplied && (
                <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                    <span>
                      <b>Stop on Reply executado:</b> este contato respondeu no LinkedIn. Todos os próximos follow-ups foram cancelados automaticamente para preservar o relacionamento.
                    </span>
                  </div>
                </div>
              )}

              {/* Área de mensagens — thread REAL carregada via getConversation */}
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {thread.length === 0 && (
                  <p className="text-center text-sm text-slate-400">
                    Nenhuma mensagem nesta conversa ainda.
                  </p>
                )}
                {thread.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.direction === "outbound" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
                      <span>{msg.direction === "outbound" ? "Enviado por você (extensão)" : activeConv.leadName}</span>
                      <span>·</span>
                      <span>{msg.sentAt}</span>
                    </div>

                    <div
                      className={`max-w-lg rounded-2xl p-3.5 text-sm leading-relaxed ${
                        msg.direction === "outbound"
                          ? "rounded-br-sm bg-indigo-600 text-white"
                          : "rounded-bl-sm border border-[#e8eaf1] bg-[#f8f9fc] text-slate-700"
                      }`}
                    >
                      <p className="whitespace-pre-line">{msg.content}</p>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      {msg.stepTag && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                          {msg.stepTag}
                        </span>
                      )}
                      {msg.direction === "outbound" && (
                        <span className="flex items-center gap-1 text-indigo-600">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Entregue via LinkedIn</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center space-y-3 p-8 text-center text-slate-500">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#e8eaf1] bg-[#f4f5fa]">
                <ShieldCheck className="h-6 w-6 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Inbox integrada do LinkedIn</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
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

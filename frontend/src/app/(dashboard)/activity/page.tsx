"use client";

import { useEffect, useState } from "react";
import {
  Search,
  RefreshCw,
  Terminal,
  Send,
  UserCheck,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLiveEvents } from "@/lib/sse";
import { ActivityEvent } from "@vibexcorp/api-client";

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { token } = useAuth();

  const loadActivity = async () => {
    setIsLoading(true);
    try {
      const res = await api.listActivity();
      setEvents(res.activity || []);
    } catch {
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 4000);
    return () => clearInterval(interval);
  }, []);

  // AO VIVO: novo evento do backend aparece na trilha na hora (SSE); o poll
  // de 4s continua como rede de segurança para reconexões.
  useLiveEvents(token, (type) => {
    if (
      type === "message.queued" ||
      type === "message.sent" ||
      type === "reply.detected" ||
      type === "extension.paired" ||
      type === "extension.heartbeat" ||
      type === "contact.created" ||
      type === "contacts.synced"
    ) {
      loadActivity();
    }
  });

  const filtered = events.filter((ev) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      ev.event_type.toLowerCase().includes(term) ||
      (ev.description && ev.description.toLowerCase().includes(term)) ||
      (ev.entity_type && ev.entity_type.toLowerCase().includes(term))
    );
  });

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Trilha de atividade</h2>
          <p className="mt-1 text-sm text-slate-500">
            Registro em tempo real de mensagens disparadas pela extensão no LinkedIn, sincronizações e eventos do sistema.
          </p>
        </div>

        <button
          onClick={loadActivity}
          className="flex w-fit items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          <span>Atualizar trilha</span>
        </button>
      </div>

      {/* Barra de filtro */}
      <div className="rounded-2xl border border-[#e8eaf1] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="relative w-full sm:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filtrar por evento, lead ou conteúdo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {/* Tabela de auditoria */}
      <div className="overflow-hidden rounded-2xl border border-[#e8eaf1] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {isLoading && events.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-14 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            <span>Carregando trilha de auditoria...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="space-y-2 p-14 text-center text-slate-500">
            <Terminal className="mx-auto h-7 w-7 text-slate-300" />
            <span className="block text-sm font-medium text-slate-600">
              Nenhum evento registrado ainda
            </span>
            <p className="mx-auto max-w-sm text-sm text-slate-400">
              Todas as mensagens enviadas pela extensão no LinkedIn e atualizações do sistema serão auditadas aqui.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="border-b border-[#e8eaf1] bg-[#f8f9fc] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Data / hora</th>
                  <th className="p-4">Tipo de evento</th>
                  <th className="p-4">Detalhes</th>
                  <th className="p-4">Canal / origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef0f6]">
                {filtered.map((ev) => {
                  const isMsg = ev.event_type.includes("message");
                  const isSync = ev.event_type.includes("synced") || ev.event_type.includes("contact");
                  const isReply = ev.event_type.includes("reply");

                  return (
                    <tr key={ev.id} className="transition hover:bg-[#f8f9fc]">
                      <td className="whitespace-nowrap p-4 font-mono text-slate-500">
                        {new Date(ev.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        <span className="block text-xs">
                          {new Date(ev.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </td>

                      <td className="whitespace-nowrap p-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            isMsg
                              ? "border-indigo-100 bg-indigo-50 text-indigo-700"
                              : isReply
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : isSync
                              ? "border-sky-100 bg-sky-50 text-sky-700"
                              : "border-slate-200 bg-slate-100 text-slate-600"
                          }`}
                        >
                          {isMsg && <Send className="h-3 w-3" />}
                          {isReply && <Sparkles className="h-3 w-3" />}
                          {isSync && <UserCheck className="h-3 w-3" />}
                          <span>{ev.event_type}</span>
                        </span>
                      </td>

                      <td className="p-4">
                        <div className="font-medium text-slate-900">
                          {ev.description || "Evento operacional registrado no sistema"}
                        </div>
                        {ev.payload && typeof ev.payload === "object" && (
                          <div className="mt-1 inline-block max-w-xl truncate rounded-lg border border-[#eef0f6] bg-[#f8f9fc] p-1.5 font-mono text-xs text-slate-500">
                            {ev.payload.message_body ? (
                              <span>&ldquo;{String(ev.payload.message_body)}&rdquo;</span>
                            ) : ev.payload.contact_name ? (
                              <span>
                                Lead: {String(ev.payload.contact_name)}{" "}
                                {ev.payload.company ? `(${String(ev.payload.company)})` : ""}
                              </span>
                            ) : (
                              <span>{JSON.stringify(ev.payload)}</span>
                            )}
                          </div>
                        )}
                        {/* Métrica de latência do Jev por disparo (só message.sent
                            com números reais; sem amostra = linha omitida). */}
                        {ev.event_type === "message.sent" &&
                          ev.payload &&
                          typeof ev.payload === "object" &&
                          typeof (ev.payload as Record<string, unknown>)["jev_ms"] === "number" &&
                          ((ev.payload as Record<string, unknown>)["jev_ms"] as number) > 0 && (
                          <div className="mt-1 text-xs text-slate-500">
                            Jev {String((ev.payload as Record<string, unknown>)["jev_ms"])} ms
                            {typeof (ev.payload as Record<string, unknown>)["assist_total_ms"] === "number" &&
                              ((ev.payload as Record<string, unknown>)["assist_total_ms"] as number) > 0 &&
                              ` · total ${String((ev.payload as Record<string, unknown>)["assist_total_ms"])} ms`}
                            {typeof (ev.payload as Record<string, unknown>)["assist_roundtrip_ms"] === "number" &&
                              ((ev.payload as Record<string, unknown>)["assist_roundtrip_ms"] as number) > 0 &&
                              ` · ida-volta ${String((ev.payload as Record<string, unknown>)["assist_roundtrip_ms"])} ms`}
                            {typeof (ev.payload as Record<string, unknown>)["assist_source"] === "string" &&
                              (ev.payload as Record<string, unknown>)["assist_source"] !== "" &&
                              ` · fonte ${String((ev.payload as Record<string, unknown>)["assist_source"])}`}
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap p-4">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e8eaf1] bg-[#f4f5fa] px-2.5 py-0.5 text-xs text-slate-600">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span>
                            {isReply
                              ? "LinkedIn (resposta)"
                              : isMsg
                              ? "Extensão → LinkedIn"
                              : isSync
                              ? "Extensão (extração)"
                              : "Sistema"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

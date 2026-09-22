"use client";

import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  ShieldCheck,
  Search,
  RefreshCw,
  Terminal,
  Send,
  UserCheck,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { ActivityEvent } from "@vibexcorp/api-client";

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

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
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Trilha de Atividade & Mensagens</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Registro em tempo real de mensagens disparadas pela extensão no LinkedIn, sincronizações e eventos de segurança.
          </p>
        </div>

        <button
          onClick={loadActivity}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-800 bg-[#16171a] hover:bg-zinc-800 text-xs text-zinc-300 font-medium transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Atualizar Trilha</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-2.5 rounded-lg border border-zinc-800 bg-[#111215]">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Filtrar por evento, lead ou conteúdo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
          />
        </div>
      </div>

      {/* Audit Log Table (Attio high density) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] overflow-hidden">
        {isLoading && events.length === 0 ? (
          <div className="p-12 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
            <span>Carregando trilha de auditoria...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-zinc-500">
            <Terminal className="w-6 h-6 mx-auto text-zinc-600" />
            <span className="text-xs font-medium text-zinc-400 block">Nenhum evento registrado ainda</span>
            <p className="text-[11px] max-w-sm mx-auto">
              Todas as mensagens enviadas pela extensão no LinkedIn e atualizações do sistema serão auditadas aqui.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-[#141518] text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800 font-mono">
                <tr>
                  <th className="p-3">Data / Hora</th>
                  <th className="p-3">Tipo de Evento</th>
                  <th className="p-3">Detalhes da Ação / Mensagem</th>
                  <th className="p-3">Canal / Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-[11px]">
                {filtered.map((ev) => {
                  const isMsg = ev.event_type.includes("message");
                  const isSync = ev.event_type.includes("synced") || ev.event_type.includes("contact");
                  const isReply = ev.event_type.includes("reply");

                  return (
                    <tr key={ev.id} className="hover:bg-zinc-800/30 transition">
                      <td className="p-3 text-zinc-400 font-mono whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <span className="block text-[9px] text-zinc-600 font-mono">
                          {new Date(ev.created_at).toLocaleDateString()}
                        </span>
                      </td>

                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                            isMsg
                              ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                              : isReply
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : isSync
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {isMsg && <Send className="w-2.5 h-2.5" />}
                          {isReply && <Sparkles className="w-2.5 h-2.5" />}
                          {isSync && <UserCheck className="w-2.5 h-2.5" />}
                          <span>{ev.event_type}</span>
                        </span>
                      </td>

                      <td className="p-3 text-zinc-200">
                        <div className="font-medium text-xs text-white">
                          {ev.description || "Evento operacional registrado no sistema"}
                        </div>
                        {ev.payload && typeof ev.payload === "object" && (
                          <div className="mt-1 text-[11px] text-zinc-400 font-mono bg-[#16171a] p-1.5 rounded border border-zinc-800/80 inline-block max-w-xl truncate">
                            {ev.payload.message_body ? (
                              <span>💬 &ldquo;{String(ev.payload.message_body)}&rdquo;</span>
                            ) : ev.payload.contact_name ? (
                              <span>Lead: {String(ev.payload.contact_name)} {ev.payload.company ? `(${String(ev.payload.company)})` : ""}</span>
                            ) : (
                              <span>{JSON.stringify(ev.payload)}</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="p-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded border border-zinc-700/40">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>LinkedIn Extensão</span>
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

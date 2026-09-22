"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Target,
  Users,
  Clock,
  MessageSquareReply,
  CheckCircle2,
  Linkedin,
  Puzzle,
  ArrowRight,
  Plus,
  RefreshCw,
  Activity as ActivityIcon,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { DashboardMetrics, Campaign, ActivityEvent } from "@vibexcorp/api-client";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    active_campaigns: 0,
    contacts_in_seq: 0,
    waiting_followups: 0,
    replies: 0,
    completed: 0,
    telemetry_processed: 0,
    kill_switch_active: false,
    extension_connected: false,
    linkedin_connected: false,
  });

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = async () => {
    try {
      const [metRes, campRes, actRes] = await Promise.all([
        api.getDashboardMetrics().catch(() => null),
        api.listCampaigns().catch(() => ({ campaigns: [] })),
        api.listActivity().catch(() => ({ activity: [] })),
      ]);

      if (metRes) setMetrics(metRes);
      if (campRes?.campaigns) setCampaigns(campRes.campaigns);
      if (actRes?.activity) setActivities(actRes.activity);
    } catch {
      // Graceful fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome & Quick Actions (Attio Minimalist Header) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-800/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Visão Geral & Cadência</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Monitoramento em tempo real de campanhas, conexões e automações de outreach.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-800 bg-[#141518] hover:border-zinc-700 text-xs font-medium text-zinc-300 transition"
          >
            <Linkedin className="w-3.5 h-3.5 text-[#0077b5]" />
            <span>{metrics.linkedin_connected ? "LinkedIn Conectado" : "Conectar LinkedIn"}</span>
          </Link>

          <Link
            href="/campaigns/new"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova Campanha</span>
          </Link>
        </div>
      </div>

      {/* Integration Status Badges Bar (Attio High Density) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* LinkedIn Connection Status */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-800 bg-[#111215]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#0077b5]/10 border border-[#0077b5]/30 flex items-center justify-center text-[#0077b5]">
              <Linkedin className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">Integração LinkedIn</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    metrics.linkedin_connected
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  {metrics.linkedin_connected ? "CONECTADO" : "DESCONECTADO"}
                </span>
              </div>
              <span className="text-[11px] text-zinc-400">
                {metrics.linkedin_connected
                  ? "Pronto para disparos automáticos para suas conexões"
                  : "Conecte sua conta para habilitar o envio de mensagens"}
              </span>
            </div>
          </div>
          {!metrics.linkedin_connected && (
            <Link
              href="/settings"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
            >
              <span>Conectar</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>

        {/* WXT Extension Status */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-800 bg-[#111215]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Puzzle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">Extensão de Navegador (WXT)</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    metrics.extension_connected
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  {metrics.extension_connected ? "ONLINE" : "AGUARDANDO"}
                </span>
              </div>
              <span className="text-[11px] text-zinc-400">
                {metrics.extension_connected
                  ? "Sincronização de conexões e heartbeat ativos"
                  : "Pareie a extensão para sincronizar contatos com 1 clique"}
              </span>
            </div>
          </div>
          <Link
            href="/settings"
            className="text-xs text-zinc-400 hover:text-zinc-200 font-medium flex items-center gap-1"
          >
            <span>Parear</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* 4 Core KPIs (Real Data Only — Zero Mock Data) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-zinc-800 bg-[#111215] space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Campanhas Ativas</span>
            <Target className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.active_campaigns}
          </div>
          <span className="text-[11px] text-zinc-500 block">Cadências em execução</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-[#111215] space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Contatos em Sequência</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.contacts_in_seq}
          </div>
          <span className="text-[11px] text-zinc-500 block">Aguardando ou em fluxo</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-[#111215] space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Próximos Follow-ups</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.waiting_followups}
          </div>
          <span className="text-[11px] text-zinc-500 block">Programados pelo scheduler</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-[#111215] space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Respostas (Stop on Reply)</span>
            <MessageSquareReply className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.replies}
          </div>
          <span className="text-[11px] text-emerald-500/90 block">Follow-ups pausados com sucesso</span>
        </div>
      </div>

      {/* Main Grid: Active Campaigns & Live Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Campaigns List (2 cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Campanhas Recentes</h2>
            <Link href="/campaigns" className="text-xs text-zinc-400 hover:text-white transition">
              Ver todas ({campaigns.length})
            </Link>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-[#111215] overflow-hidden">
            {campaigns.length === 0 ? (
              /* Attio-Style Clean Empty State */
              <div className="p-12 text-center space-y-3">
                <div className="w-10 h-10 rounded-lg bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-center text-zinc-400 mx-auto">
                  <Target className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Nenhuma campanha criada</h3>
                  <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                    Crie sua primeira campanha para disparar mensagens personalizadas para suas conexões do LinkedIn.
                  </p>
                </div>
                <Link
                  href="/campaigns/new"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Criar Campanha</span>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {campaigns.slice(0, 5).map((camp) => (
                  <div
                    key={camp.id}
                    className="p-4 flex items-center justify-between hover:bg-zinc-800/30 transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaigns/${camp.id}/builder`}
                          className="text-xs font-semibold text-white hover:text-indigo-400 transition"
                        >
                          {camp.name}
                        </Link>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                            camp.status === "running"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : camp.status === "paused"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {camp.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        Limite diário: {camp.daily_limit} msg · {camp.timezone}
                      </span>
                    </div>

                    <Link
                      href={`/campaigns/${camp.id}/builder`}
                      className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
                    >
                      <span>Abrir Flow</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Audit Activity (1 col) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Log de Atividade em Tempo Real</h2>
            <Link href="/activity" className="text-xs text-zinc-400 hover:text-white transition">
              Auditoria
            </Link>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-[#111215] p-4">
            {activities.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 space-y-2">
                <ActivityIcon className="w-6 h-6 mx-auto text-zinc-600" />
                <p>Nenhuma atividade registrada ainda.</p>
                <span className="text-[10px] text-zinc-600 block">
                  Os eventos de execução, agendamento e detecção de respostas serão exibidos aqui.
                </span>
              </div>
            ) : (
              <div className="space-y-3 font-sans">
                {activities.slice(0, 6).map((act) => (
                  <div key={act.id} className="text-xs pb-3 border-b border-zinc-800/60 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <span className="font-mono text-[10px] text-indigo-400">{act.event_type}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {new Date(act.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-zinc-300 text-[11px] leading-relaxed truncate">
                      {act.entity_type}: {act.entity_id}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

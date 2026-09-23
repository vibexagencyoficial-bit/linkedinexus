"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Target,
  Users,
  MessageSquareReply,
  CheckCircle2,
  Linkedin,
  Puzzle,
  Plus,
  RefreshCw,
  Layers,
  Clock,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLiveEvents } from "@/lib/sse";
import { DashboardMetrics } from "@vibexcorp/api-client";

// Cena 3D carregada só no cliente (Three.js não roda no servidor)
const OutreachOrb = dynamic(
  () => import("@/components/dashboard/OutreachOrb").then((m) => m.OutreachOrb),
  { ssr: false }
);

const EMPTY_METRICS: DashboardMetrics = {
  active_campaigns: 0,
  contacts_in_seq: 0,
  waiting_followups: 0,
  replies: 0,
  completed: 0,
  telemetry_processed: 0,
  kill_switch_active: false,
  extension_connected: false,
  linkedin_connected: false,
};

function KpiCard({
  title,
  value,
  icon: Icon,
  tone,
  subtitle,
}: {
  title: string;
  value: number | string;
  icon: typeof Target;
  tone: "indigo" | "emerald" | "rose" | "amber";
  subtitle?: string;
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
  } as const;
  return (
    <div className="rounded-2xl border border-[#e8eaf1] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

/** Barras com a distribuição real dos contatos (nenhum número inventado). */
function StatusBars({ metrics }: { metrics: DashboardMetrics }) {
  const bars = [
    { label: "Na cadência", value: Math.max(metrics.contacts_in_seq - metrics.completed, 0), color: "#6366f1" },
    { label: "Aguardando follow-up", value: metrics.waiting_followups, color: "#f59e0b" },
    { label: "Respostas", value: metrics.replies, color: "#ec4899" },
    { label: "Concluídos", value: metrics.completed, color: "#10b981" },
  ];
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div className="flex h-44 items-end gap-6 pt-2" role="img" aria-label="Distribuição atual dos contatos por status">
      {bars.map((bar) => (
        <div key={bar.label} className="flex flex-1 flex-col items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{bar.value}</span>
          <div className="flex w-full max-w-[72px] items-end" style={{ height: 120 }}>
            <div
              className="w-full rounded-t-lg transition-all duration-500"
              style={{
                height: `${Math.max((bar.value / max) * 100, bar.value > 0 ? 6 : 2)}%`,
                backgroundColor: bar.color,
                opacity: bar.value > 0 ? 1 : 0.25,
              }}
            />
          </div>
          <span className="text-center text-xs leading-tight text-slate-500">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

function ConnectionRow({
  icon: Icon,
  name,
  detail,
  ok,
  okLabel,
  offLabel,
}: {
  icon: typeof Linkedin;
  name: string;
  detail: string;
  ok: boolean;
  okLabel: string;
  offLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#e8eaf1] bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-400">{detail}</p>
        </div>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        {ok ? okLabel : offLabel}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { token } = useAuth();

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getDashboardMetrics();
      setMetrics({ ...EMPTY_METRICS, ...data });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Falha ao carregar os dados do painel");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 15000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  // AO VIVO: disparo enfileirado/enviado, resposta ou sinal da extensão
  // atualizam os KPIs na hora (SSE), sem esperar o poll de 15s.
  useLiveEvents(token, (type) => {
    if (
      type === "message.queued" ||
      type === "message.sent" ||
      type === "reply.detected" ||
      type === "extension.paired" ||
      type === "extension.heartbeat" ||
      type === "integration.updated"
    ) {
      loadDashboardData();
    }
  });

  const lastSeen = metrics.extension_last_seen
    ? new Date(metrics.extension_last_seen).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {metrics.kill_switch_active && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          A pausa global está ativa: nenhum envio será despachado até ser retomada no cabeçalho.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-2xl border border-[#e8eaf1] bg-white" />
          ))
        ) : loadError ? (
          <div className="col-span-full flex flex-col items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-5">
            <p className="text-sm font-medium text-red-700">{loadError}</p>
            <button
              onClick={loadDashboardData}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <KpiCard title="Campanhas ativas" value={metrics.active_campaigns} icon={Target} tone="indigo" />
            <KpiCard title="Contatos na cadência" value={metrics.contacts_in_seq} icon={Users} tone="amber" />
            <KpiCard title="Respostas recebidas" value={metrics.replies} icon={MessageSquareReply} tone="rose" />
            <KpiCard title="Concluídos" value={metrics.completed} icon={CheckCircle2} tone="emerald" />
            {/* Latência média do Jev (24h): vazio honesto sem amostras — nunca 0ms inventado. */}
            <KpiCard
              title="Latência média do Jev"
              value={
                metrics.jev_avg_ms != null && (metrics.jev_samples ?? 0) > 0
                  ? `${Math.round(metrics.jev_avg_ms)} ms`
                  : "—"
              }
              subtitle={
                (metrics.jev_samples ?? 0) > 0
                  ? `${metrics.jev_samples} disparo${metrics.jev_samples === 1 ? "" : "s"} (24h)`
                  : "sem disparos nas últimas 24h"
              }
              icon={Zap}
              tone="indigo"
            />
          </>
        )}
      </div>

      {/* Desempenho + Distribuição 3D */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Desempenho de Envios</h2>
              <p className="text-xs text-slate-400">Distribuição atual dos contatos por status</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] px-3 py-1.5 text-xs font-medium text-slate-500">
              <Layers className="h-3.5 w-3.5" />
              {metrics.telemetry_processed} jobs processados
            </div>
          </div>
          <StatusBars metrics={metrics} />
        </div>

        <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="text-base font-bold text-slate-900">Distribuição de Outreach</h2>
          <p className="mb-2 text-xs text-slate-400">Cada ponto é um contato real. Arraste para girar.</p>
          <div className="h-56 w-full">
            <OutreachOrb
              inSequence={Math.max(metrics.contacts_in_seq - metrics.completed, 0)}
              waiting={metrics.waiting_followups}
              replies={metrics.replies}
              completed={metrics.completed}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Na cadência</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Aguardando</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-pink-500" /> Respostas</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Concluídos</span>
          </div>
        </div>
      </div>

      {/* Conexões reais */}
      <div className="rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Conexões</h2>
            <p className="text-xs text-slate-400">Status em tempo real das integrações do painel</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/campaigns/new"
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" /> Nova campanha
            </Link>
            <button
              onClick={loadDashboardData}
              className="flex items-center gap-1.5 rounded-lg border border-[#e8eaf1] px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ConnectionRow
            icon={Linkedin}
            name="Conta do LinkedIn"
            detail={metrics.linkedin_status === "connected" ? "Conectada e apta a enviar" : "Nenhuma conta conectada"}
            ok={Boolean(metrics.linkedin_connected)}
            okLabel="Conectado"
            offLabel="Desconectado"
          />
          <ConnectionRow
            icon={Puzzle}
            name="Extensão Chrome"
            detail={lastSeen ? `Último sinal às ${lastSeen}` : "Nunca conectou"}
            ok={Boolean(metrics.extension_connected)}
            okLabel="Conectado"
            offLabel="Offline"
          />
          <ConnectionRow
            icon={Clock}
            name="Fila de envios"
            detail={`${metrics.telemetry_processed} jobs processados pelo worker`}
            ok={metrics.telemetry_processed > 0}
            okLabel="Ativa"
            offLabel="Ociosa"
          />
        </div>
      </div>
    </div>
  );
}

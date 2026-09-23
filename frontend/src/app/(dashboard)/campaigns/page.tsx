"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Target, Play, Pause, ExternalLink, Calendar, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Campaign } from "@vibexcorp/api-client";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadCampaigns = async () => {
    setIsLoading(true);
    try {
      const res = await api.listCampaigns();
      setCampaigns(res.campaigns || []);
    } catch {
      setCampaigns([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const handleTogglePause = async (camp: Campaign) => {
    try {
      if (camp.status === "running") {
        await api.pauseCampaign(camp.id);
      } else {
        await api.resumeCampaign(camp.id);
      }
      await loadCampaigns();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Falha ao alterar estado da campanha.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Campanhas de Outreach</h2>
          <p className="mt-1 text-sm text-slate-500">
            Gerencie suas sequências de cadência, acompanhe o progresso e configure as regras de fluxo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadCampaigns}
            title="Atualizar"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/campaigns/new"
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(79,70,229,0.25)] transition hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            <span>Nova campanha</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#e8eaf1] bg-white p-14 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
          <span>Carregando campanhas...</span>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-3 rounded-2xl border border-[#e8eaf1] bg-white p-16 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e8eaf1] bg-[#f4f5fa] text-slate-400">
            <Target className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">Nenhuma campanha cadastrada</h3>
            <p className="max-w-sm text-sm text-slate-500">
              Crie uma campanha com fluxo de cadência personalizado para disparar mensagens automáticas para suas conexões do LinkedIn.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              <span>Criar primeira campanha</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((camp) => (
            <div
              key={camp.id}
              className="flex flex-col space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-indigo-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        camp.status === "running" ? "animate-pulse bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    <h3 className="text-base font-semibold text-slate-900">{camp.name}</h3>
                  </div>
                  <p className="line-clamp-1 text-sm text-slate-500">
                    {camp.description || "Cadência automatizada"}
                  </p>
                </div>

                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${
                    camp.status === "running"
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : camp.status === "paused"
                      ? "border-amber-100 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-100 text-slate-600"
                  }`}
                >
                  {camp.status === "running"
                    ? "Ativa"
                    : camp.status === "paused"
                    ? "Pausada"
                    : camp.status === "draft"
                    ? "Rascunho"
                    : camp.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#eef0f6] bg-[#f8f9fc] p-3.5">
                <div>
                  <span className="block text-xs text-slate-400">Contatos</span>
                  <span className="text-sm font-bold text-slate-900">{camp.total_contacts || 0} leads</span>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Respostas (parar no reply)</span>
                  <span className="text-sm font-bold text-emerald-600">{camp.replied_contacts || 0} detectadas</span>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between border-t border-[#eef0f6] pt-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{new Date(camp.created_at).toLocaleDateString("pt-BR")}</span>
                </span>

                <div className="flex items-center gap-2">
                  {camp.status === "running" ? (
                    <button
                      onClick={() => handleTogglePause(camp)}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
                    >
                      <Pause className="h-3.5 w-3.5" />
                      <span>Pausar</span>
                    </button>
                  ) : camp.status === "paused" ? (
                    <button
                      onClick={() => handleTogglePause(camp)}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Retomar</span>
                    </button>
                  ) : null}

                  <Link
                    href={`/campaigns/${camp.id}/builder`}
                    className="flex items-center gap-1.5 rounded-lg border border-[#e8eaf1] bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span>Fluxo</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

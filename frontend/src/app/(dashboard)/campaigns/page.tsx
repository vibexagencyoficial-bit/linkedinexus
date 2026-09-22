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
    } catch (err: any) {
      alert(err?.message || "Falha ao alterar estado da campanha.");
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Campanhas de Outreach</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Gerencie suas sequências de cadência, acompanhe progresso e configure regras de fluxo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadCampaigns}
            title="Atualizar"
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/campaigns/new"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova Campanha</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-16 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
          <span>Carregando campanhas...</span>
        </div>
      ) : campaigns.length === 0 ? (
        /* Attio-Style Clean Empty State (Zero imaginary data) */
        <div className="rounded-xl border border-zinc-800 bg-[#111215] p-16 flex flex-col items-center justify-center text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
            <Target className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">Nenhuma campanha cadastrada</h3>
            <p className="text-xs text-zinc-400 max-w-sm">
              Crie uma campanha com fluxo de cadência personalizado para disparar mensagens automáticas para suas conexões do LinkedIn.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Primeira Campanha</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((camp) => (
            <div
              key={camp.id}
              className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4 hover:border-zinc-700 transition"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        camp.status === "running" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                      }`}
                    />
                    <h3 className="text-sm font-semibold text-white">{camp.name}</h3>
                  </div>
                  <p className="text-xs text-zinc-400 line-clamp-1">{camp.description || "Cadência automatizada"}</p>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase ${
                    camp.status === "running"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : camp.status === "paused"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  {camp.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-zinc-400 bg-[#16171a] p-3 rounded-lg border border-zinc-800/80">
                <div>
                  <span className="text-[10px] text-zinc-500 block">Contatos</span>
                  <span className="text-white font-bold text-xs">{camp.total_contacts || 0} leads</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">Respostas (Stop on Reply)</span>
                  <span className="text-emerald-400 font-bold text-xs">{camp.replied_contacts || 0} detectadas</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-zinc-500 flex items-center gap-1 font-mono">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(camp.created_at).toLocaleDateString()}</span>
                </span>

                <div className="flex items-center gap-2">
                  {camp.status === "running" ? (
                    <button
                      onClick={() => handleTogglePause(camp)}
                      className="px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs font-medium flex items-center gap-1 transition"
                    >
                      <Pause className="w-3 h-3" />
                      <span>Pausar</span>
                    </button>
                  ) : camp.status === "paused" ? (
                    <button
                      onClick={() => handleTogglePause(camp)}
                      className="px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium flex items-center gap-1 transition"
                    >
                      <Play className="w-3 h-3" />
                      <span>Retomar</span>
                    </button>
                  ) : null}

                  <Link
                    href={`/campaigns/${camp.id}/builder`}
                    className="flex items-center space-x-1 px-3 py-1 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition"
                  >
                    <span>Flow Builder</span>
                    <ExternalLink className="w-3 h-3" />
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

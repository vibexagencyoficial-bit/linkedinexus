"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ArrowRight,
  Clock,
  Sliders,
  CheckCircle2,
  Workflow,
} from "lucide-react";
import { api } from "@/lib/api";

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dailyLimit, setDailyLimit] = useState(30);
  const [allowedStart, setAllowedStart] = useState("08:00");
  const [allowedEnd, setAllowedEnd] = useState("18:00");
  const [useRecommendedTemplate, setUseRecommendedTemplate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const res = await api.createCampaign({
        name: name.trim(),
        description: description.trim(),
        daily_limit: dailyLimit,
        allowed_start_time: allowedStart + ":00",
        allowed_end_time: allowedEnd + ":00",
        timezone: "America/Sao_Paulo",
        is_flow_custom: !useRecommendedTemplate,
      });

      // If user chose recommended template, initialize recommended flow steps
      if (useRecommendedTemplate) {
        await api.saveCampaignSteps(res.id, [
          {
            position: 1,
            step_type: "MESSAGE",
            name: "Mensagem Inicial de Conexão",
            template_body: "Olá {{first_name}}, vi que você atua na {{company}} como {{job_title}} e gostaria de compartilhar uma solução rápida...",
            delay_amount: 0,
            delay_unit: "days",
          },
          {
            position: 2,
            step_type: "WAIT",
            name: "Aguardar Janela de Resposta",
            template_body: "",
            delay_amount: 2,
            delay_unit: "days",
          },
          {
            position: 3,
            step_type: "CHECK_REPLY",
            name: "Verificar Resposta (Stop on Reply)",
            template_body: "",
            delay_amount: 0,
            delay_unit: "days",
            conditions: { stop_if_replied: true },
          },
          {
            position: 4,
            step_type: "MESSAGE",
            name: "Follow-up #1: Compartilhar Valor",
            template_body: "Oi {{first_name}}, passando para saber se teve tempo de avaliar minha mensagem anterior...",
            delay_amount: 0,
            delay_unit: "days",
          },
          {
            position: 5,
            step_type: "WAIT",
            name: "Aguardar Janela de Resposta #2",
            template_body: "",
            delay_amount: 4,
            delay_unit: "days",
          },
          {
            position: 6,
            step_type: "CHECK_REPLY",
            name: "Verificar Resposta (Stop on Reply)",
            template_body: "",
            delay_amount: 0,
            delay_unit: "days",
            conditions: { stop_if_replied: true },
          },
          {
            position: 7,
            step_type: "END",
            name: "Fim da Cadência",
            template_body: "",
            delay_amount: 0,
            delay_unit: "days",
          },
        ]).catch(() => null);
      }

      router.push(`/campaigns/${res.id}/builder`);
    } catch (err: any) {
      alert("Erro ao criar campanha: " + (err?.message || ""));
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Criar Nova Campanha de Outreach</h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Configure sua cadência, defina o fluxo de mensagens e selecione os limites operacionais.
        </p>
      </div>

      <form onSubmit={handleCreate} className="rounded-xl border border-zinc-800 bg-[#111215] p-6 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
            Nome da Campanha *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Prospecção de Diretores de Tecnologia e Growth"
            className="w-full px-3 py-2 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
            Descrição do Objetivo (Opcional)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Cadência de follow-up com 2 etapas e stop on reply imediato para conexões do LinkedIn."
            className="w-full px-3 py-2 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Cadence Flow Choice (Spec Section 18) */}
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-2">
            Modelo de Fluxo Inicial
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setUseRecommendedTemplate(true)}
              className={`p-3.5 rounded-lg border text-left transition ${
                useRecommendedTemplate
                  ? "border-indigo-500/60 bg-indigo-950/20 text-white"
                  : "border-zinc-800 bg-[#16171a] text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>VibexCorp Standard</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-300">
                  Recomendado
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-snug">
                Cadência padrão de 3 etapas com verificação Stop on Reply entre envios.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setUseRecommendedTemplate(false)}
              className={`p-3.5 rounded-lg border text-left transition ${
                !useRecommendedTemplate
                  ? "border-indigo-500/60 bg-indigo-950/20 text-white"
                  : "border-zinc-800 bg-[#16171a] text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Workflow className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Fluxo em Branco</span>
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-snug">
                Construa sua própria sequência do zero no Flow Builder interativo.
              </p>
            </button>
          </div>
        </div>

        {/* Limits & Hours */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-zinc-800/80">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Limite Diário</label>
            <input
              type="number"
              min="5"
              max="50"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(parseInt(e.target.value) || 30)}
              className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Início</label>
            <input
              type="time"
              value={allowedStart}
              onChange={(e) => setAllowedStart(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">Fim</label>
            <input
              type="time"
              value={allowedEnd}
              onChange={(e) => setAllowedEnd(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-3">
          <button
            type="submit"
            disabled={isCreating}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm disabled:opacity-50"
          >
            {isCreating ? (
              <span>Criando Campanha...</span>
            ) : (
              <>
                <span>Prosseguir para Flow Builder</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

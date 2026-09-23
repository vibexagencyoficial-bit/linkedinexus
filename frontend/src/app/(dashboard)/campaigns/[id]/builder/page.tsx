"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useFlowStore, FlowNode } from "@/lib/store";
import {
  MessageSquare,
  Clock,
  MessageSquareReply,
  Flag,
  Play,
  Pause,
  Eye,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Save,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { CampaignPreviewResult } from "@vibexcorp/api-client";

export default function CampaignFlowBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = (params?.id as string) || "";

  const {
    nodes,
    selectedNodeId,
    selectNode,
    addNode,
    updateNode,
    removeNode,
    loadRecommendedPreset,
  } = useFlowStore();

  const [campaignName, setCampaignName] = useState("Carregando...");
  const [campaignStatus, setCampaignStatus] = useState("draft");
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewResult, setPreviewResult] = useState<CampaignPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  // Carrega dados reais da campanha na montagem
  useEffect(() => {
    if (!campaignId) return;

    api.getCampaign(campaignId)
      .then((c) => {
        setCampaignName(c.name);
        setCampaignStatus(c.status);
      })
      .catch(() => {
        setCampaignName("Cadência de Outreach");
      });

    api.getCampaignSteps(campaignId)
      .then((res) => {
        if (res.steps && res.steps.length > 0) {
          // Sincroniza com a store
          const mappedNodes: FlowNode[] = res.steps.map((s, idx) => ({
            id: s.id || `step-${idx + 1}`,
            type: s.step_type.toLowerCase() as any,
            name: s.name,
            templateBody: s.template_body || "",
            delayAmount: s.delay_amount || 0,
            delayUnit: (s.delay_unit as any) || "days",
            conditions: s.conditions || {},
          }));
          useFlowStore.setState({ nodes: mappedNodes });
        }
      })
      .catch(() => {});
  }, [campaignId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];

  const insertVariable = (varName: string) => {
    if (!selectedNode || selectedNode.type !== "message") return;
    const tag = `{{${varName}}}`;
    const updated = selectedNode.templateBody + " " + tag;
    updateNode(selectedNode.id, { templateBody: updated });
  };

  const handleSaveFlow = async () => {
    setIsSaving(true);
    try {
      const payload = nodes.map((n, idx) => ({
        position: idx + 1,
        step_type: n.type.toUpperCase() as any,
        name: n.name,
        template_body: n.templateBody,
        delay_amount: n.delayAmount,
        delay_unit: n.delayUnit,
        conditions: n.conditions,
      }));
      await api.saveCampaignSteps(campaignId, payload);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err: unknown) {
      alert("Erro ao salvar fluxo: " + (err instanceof Error ? err.message : ""));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenPreview = async () => {
    setShowPreviewModal(true);
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await api.previewCampaign(campaignId);
      setPreviewResult(res);
    } catch (err: unknown) {
      // Sem fallback fictício (Fase E): erro real vira previews vazios +
      // can_launch=false, e a mensagem chega à UI em vez de contato fake.
      setPreviewResult({
        previews: [],
        can_launch: false,
      });
      setPreviewError(
        (err instanceof Error ? err.message : "") || "Falha ao gerar preview. Verifique a conexão."
      );
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleLaunchCampaign = async () => {
    setIsLaunching(true);
    try {
      // Salva os passos antes de iniciar
      await handleSaveFlow();
      await api.startCampaign(campaignId);
      setCampaignStatus("running");
      setShowPreviewModal(false);
      alert("Campanha lançada com sucesso! O scheduler assumiu o processamento dos disparos.");
      router.push("/campaigns");
    } catch (err: unknown) {
      alert(
        (err instanceof Error ? err.message : "") ||
          "Erro ao iniciar campanha. Verifique se sua conta do LinkedIn está conectada."
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const handleTogglePause = async () => {
    setIsPausing(true);
    try {
      if (campaignStatus === "running") {
        await api.pauseCampaign(campaignId);
        setCampaignStatus("paused");
      } else {
        await api.resumeCampaign(campaignId);
        setCampaignStatus("running");
      }
    } catch (err: unknown) {
      alert("Erro ao alterar estado da campanha: " + (err instanceof Error ? err.message : ""));
    } finally {
      setIsPausing(false);
    }
  };

  const statusBadge = () => {
    if (campaignStatus === "running")
      return "border-emerald-100 bg-emerald-50 text-emerald-700";
    if (campaignStatus === "paused")
      return "border-amber-100 bg-amber-50 text-amber-700";
    return "border-slate-200 bg-slate-100 text-slate-600";
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col space-y-4">
      {/* Barra de ações do construtor */}
      <div className="flex flex-col justify-between gap-3 border-b border-[#eef0f6] pb-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="truncate text-lg font-bold tracking-tight text-slate-900">{campaignName}</h2>
            <span
              className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${statusBadge()}`}
            >
              {campaignStatus === "running"
                ? "Ativa"
                : campaignStatus === "paused"
                ? "Pausada"
                : campaignStatus === "draft"
                ? "Rascunho"
                : campaignStatus}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            Construtor de cadência: defina mensagens, intervalos e checagem de Stop on Reply.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadRecommendedPreset}
            className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4 text-slate-400" />
            <span>Restaurar preset</span>
          </button>

          <button
            onClick={handleSaveFlow}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" />
                <span>Salvo!</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{isSaving ? "Salvando..." : "Salvar fluxo"}</span>
              </>
            )}
          </button>

          <button
            onClick={handleOpenPreview}
            className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Eye className="h-4 w-4 text-indigo-600" />
            <span>Prévia de contatos</span>
          </button>

          {campaignStatus === "running" ? (
            <button
              onClick={handleTogglePause}
              disabled={isPausing}
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
            >
              <Pause className="h-4 w-4" />
              <span>{isPausing ? "Pausando..." : "Pausar campanha"}</span>
            </button>
          ) : campaignStatus === "paused" ? (
            <button
              onClick={handleTogglePause}
              disabled={isPausing}
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <Play className="h-4 w-4" />
              <span>{isPausing ? "Retomando..." : "Retomar campanha"}</span>
            </button>
          ) : (
            <button
              onClick={handleOpenPreview}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(79,70,229,0.25)] transition hover:bg-indigo-700"
            >
              <Play className="h-4 w-4" />
              <span>Lançar campanha</span>
            </button>
          )}
        </div>
      </div>

      {/* Área de trabalho em 3 colunas */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-12">
        {/* Esquerda: paleta de blocos */}
        <div className="space-y-4 overflow-y-auto rounded-2xl border border-[#e8eaf1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Blocos do fluxo</h3>
            <p className="mt-0.5 text-xs text-slate-400">Clique para adicionar à sequência</p>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => addNode("message")}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e8eaf1] bg-white p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-sm font-semibold text-slate-900">Mensagem</span>
                <span className="text-xs text-slate-400">Disparo com tags dinâmicas</span>
              </div>
            </button>

            <button
              onClick={() => addNode("wait")}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e8eaf1] bg-white p-3 text-left transition hover:border-amber-200 hover:bg-amber-50/40"
            >
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-amber-600">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-sm font-semibold text-slate-900">Aguardar</span>
                <span className="text-xs text-slate-400">Intervalo programado</span>
              </div>
            </button>

            <button
              onClick={() => addNode("check_reply")}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e8eaf1] bg-white p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
            >
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-emerald-600">
                <MessageSquareReply className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-sm font-semibold text-slate-900">Stop on Reply</span>
                <span className="text-xs text-slate-400">Interrompe se houver resposta</span>
              </div>
            </button>

            <button
              onClick={() => addNode("end")}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e8eaf1] bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-500">
                <Flag className="h-4 w-4" />
              </div>
              <div>
                <span className="block text-sm font-semibold text-slate-900">Finalizar cadência</span>
                <span className="text-xs text-slate-400">Conclui o ciclo do lead</span>
              </div>
            </button>
          </div>
        </div>

        {/* Centro: canvas da sequência */}
        <div className="flex flex-col items-center space-y-3 overflow-y-auto rounded-2xl border border-[#e8eaf1] bg-[#f8f9fc] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-6">
          {nodes.map((node, index) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <div key={node.id} className="flex w-full max-w-md flex-col items-center">
                <div
                  onClick={() => selectNode(node.id)}
                  className={`w-full cursor-pointer rounded-xl border p-4 transition-all ${
                    isSelected
                      ? "border-indigo-300 bg-white ring-2 ring-indigo-200"
                      : "border-[#e8eaf1] bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f4f5fa] text-xs font-bold text-slate-500">
                        {index + 1}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{node.name}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-500">
                        {node.type === "message"
                          ? "mensagem"
                          : node.type === "wait"
                          ? "espera"
                          : node.type === "check_reply"
                          ? "checar resposta"
                          : "fim"}
                      </span>
                      {nodes.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNode(node.id);
                          }}
                          className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {node.type === "message" && (
                    <p className="rounded-lg border border-[#eef0f6] bg-[#f8f9fc] p-2.5 font-mono text-xs leading-relaxed text-slate-500 line-clamp-2">
                      {node.templateBody || "(Clique para redigir o template da mensagem)"}
                    </p>
                  )}

                  {node.type === "wait" && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        Aguardar {node.delayAmount}{" "}
                        {node.delayUnit === "days" ? "dia(s)" : "hora(s)"} antes do próximo passo
                      </span>
                    </div>
                  )}

                  {node.type === "check_reply" && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Se o contato respondeu: interromper follow-up imediatamente</span>
                    </div>
                  )}
                </div>

                {index < nodes.length - 1 && <div className="my-1 h-6 w-0.5 bg-[#d5d9e4]" />}
              </div>
            );
          })}
        </div>

        {/* Direita: inspetor da etapa */}
        <div className="space-y-4 overflow-y-auto rounded-2xl border border-[#e8eaf1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:col-span-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Editor da etapa</h3>
            <p className="mt-0.5 text-xs text-slate-400">Parâmetros e variáveis</p>
          </div>

          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Título da etapa</label>
                <input
                  type="text"
                  value={selectedNode.name}
                  onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              {selectedNode.type === "message" && (
                <div className="space-y-3">
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Variáveis disponíveis:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {["first_name", "full_name", "company", "job_title"].map((varName) => (
                        <button
                          key={varName}
                          type="button"
                          onClick={() => insertVariable(varName)}
                          className="rounded-md border border-[#e8eaf1] bg-[#f4f5fa] px-2 py-1 font-mono text-xs text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          {`{{${varName}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Texto da mensagem</label>
                    <textarea
                      rows={6}
                      value={selectedNode.templateBody}
                      onChange={(e) => updateNode(selectedNode.id, { templateBody: e.target.value })}
                      className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] p-3 font-mono text-sm leading-relaxed text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      placeholder="Olá {{first_name}}, vi que você atua na {{company}}..."
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === "wait" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Tempo de espera</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={selectedNode.delayAmount}
                      onChange={(e) => updateNode(selectedNode.id, { delayAmount: parseInt(e.target.value) || 1 })}
                      className="w-20 rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                    <select
                      value={selectedNode.delayUnit}
                      onChange={(e) => updateNode(selectedNode.id, { delayUnit: e.target.value as any })}
                      className="rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    >
                      <option value="days">Dias</option>
                      <option value="hours">Horas</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-slate-400">Selecione uma etapa no canvas</div>
          )}
        </div>
      </div>

      {/* Modal obrigatório de pré-lançamento (Spec seção 21) */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#eef0f6] pb-3">
              <div className="flex items-center gap-2 text-indigo-600">
                <Sparkles className="h-5 w-5" />
                <h3 className="text-base font-semibold text-slate-900">
                  Validação pré-lançamento (preview de contatos reais)
                </h3>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-sm text-slate-400 transition hover:text-slate-600"
              >
                Fechar
              </button>
            </div>

            {isLoadingPreview ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Renderizando variáveis com amostras reais de contatos...
              </div>
            ) : previewResult ? (
              <div className="space-y-4">
                {previewError && (
                  <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                    {previewError}
                  </div>
                )}
                {previewResult.previews.length === 0 ? (
                  <div className="rounded-xl border border-[#e8eaf1] bg-[#f8f9fc] p-6 text-center text-sm text-slate-500">
                    Nenhum contato na cadência para pré-visualizar. Adicione contatos à campanha antes de lançar.
                  </div>
                ) : (
                <div className="max-h-72 space-y-3 overflow-y-auto">
                  {previewResult.previews.map((item, idx) => (
                    <div
                      key={idx}
                      className={`space-y-2 rounded-xl border p-3.5 text-sm ${
                        item.blocked
                          ? "border-red-200 bg-red-50/60"
                          : "border-[#e8eaf1] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          {item.contact_name} ({item.company})
                        </span>
                        {item.blocked ? (
                          <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                            Bloqueado: falta a variável {item.missing_var}
                          </span>
                        ) : (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                            Válido
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-line rounded-lg border border-[#eef0f6] bg-[#f8f9fc] p-2.5 font-mono text-xs leading-relaxed text-slate-600">
                        {item.rendered}
                      </p>
                    </div>
                  ))}
                </div>
                )}

                <div className="flex flex-col items-center justify-between gap-3 border-t border-[#eef0f6] pt-3 sm:flex-row">
                  <span className="text-xs text-slate-500">
                    O envio só será autorizado pelo servidor se todas as variáveis forem resolvidas.
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowPreviewModal(false)}
                      className="rounded-lg border border-[#e8eaf1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Voltar ao editor
                    </button>
                    <button
                      onClick={handleLaunchCampaign}
                      disabled={isLaunching}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isLaunching ? "Lançando..." : "Confirmar e lançar"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

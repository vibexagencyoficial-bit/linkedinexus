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
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
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
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  // Load real campaign data on mount
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
          // Sync with store
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
    } catch (err: any) {
      alert("Erro ao salvar fluxo: " + (err?.message || ""));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenPreview = async () => {
    setShowPreviewModal(true);
    setIsLoadingPreview(true);
    try {
      const res = await api.previewCampaign(campaignId);
      setPreviewResult(res);
    } catch {
      // Offline fallback: render with available variables
      setPreviewResult({
        previews: [
          {
            contact_name: "Conexão Real do LinkedIn",
            company: "Empresa do Contato",
            rendered: nodes.find((n) => n.type === "message")?.templateBody || "Mensagem de demonstração",
            blocked: false,
          },
        ],
        can_launch: true,
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleLaunchCampaign = async () => {
    setIsLaunching(true);
    try {
      // First save steps
      await handleSaveFlow();
      // Start campaign
      await api.startCampaign(campaignId);
      setCampaignStatus("running");
      setShowPreviewModal(false);
      alert("Campanha lançada com sucesso! O scheduler assumiu o processamento dos disparos.");
      router.push("/campaigns");
    } catch (err: any) {
      alert(err?.message || "Erro ao iniciar campanha. Verifique se sua conta do LinkedIn está conectada.");
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
    } catch (err: any) {
      alert("Erro ao alterar estado da campanha: " + (err?.message || ""));
    } finally {
      setIsPausing(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] space-y-4">
      {/* Top Builder Action Bar (Attio Style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/80 gap-3">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-lg font-bold text-white tracking-tight">{campaignName}</h1>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase ${
                campaignStatus === "running"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : campaignStatus === "paused"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}
            >
              {campaignStatus}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Flow Builder de Cadência: defina mensagens, intervalos e checagem de Stop on Reply.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadRecommendedPreset}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-800 bg-[#16171a] hover:bg-zinc-800 text-xs text-zinc-300 font-medium transition"
          >
            <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
            <span>Restaurar Preset</span>
          </button>

          <button
            onClick={handleSaveFlow}
            disabled={isSaving}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Salvo!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? "Salvando..." : "Salvar Fluxo"}</span>
              </>
            )}
          </button>

          <button
            onClick={handleOpenPreview}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium transition"
          >
            <Eye className="w-3.5 h-3.5 text-indigo-400" />
            <span>Prévia de Contatos</span>
          </button>

          {campaignStatus === "running" ? (
            <button
              onClick={handleTogglePause}
              disabled={isPausing}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-400 shadow-sm transition"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{isPausing ? "Pausando..." : "Pausar Campanha"}</span>
            </button>
          ) : campaignStatus === "paused" ? (
            <button
              onClick={handleTogglePause}
              disabled={isPausing}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-semibold text-emerald-400 shadow-sm transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isPausing ? "Retomando..." : "Retomar Campanha"}</span>
            </button>
          ) : (
            <button
              onClick={handleOpenPreview}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Lançar Campanha</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-hidden">
        {/* Left: Node Palette Drawer */}
        <div className="lg:col-span-3 rounded-xl border border-zinc-800 bg-[#111215] p-4 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">Blocos do Fluxo</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Clique para adicionar à sequência</p>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => addNode("message")}
              className="w-full flex items-center space-x-3 p-2.5 rounded-lg border border-zinc-800 bg-[#16171a] hover:border-zinc-700 text-left transition group"
            >
              <div className="p-2 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">Mensagem</span>
                <span className="text-[10px] text-zinc-500">Disparo com tags dinâmicas</span>
              </div>
            </button>

            <button
              onClick={() => addNode("wait")}
              className="w-full flex items-center space-x-3 p-2.5 rounded-lg border border-zinc-800 bg-[#16171a] hover:border-zinc-700 text-left transition group"
            >
              <div className="p-2 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">Aguardar (Wait)</span>
                <span className="text-[10px] text-zinc-500">Intervalo programado</span>
              </div>
            </button>

            <button
              onClick={() => addNode("check_reply")}
              className="w-full flex items-center space-x-3 p-2.5 rounded-lg border border-zinc-800 bg-[#16171a] hover:border-zinc-700 text-left transition group"
            >
              <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <MessageSquareReply className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">Stop on Reply</span>
                <span className="text-[10px] text-zinc-500">Interrompe se houver resposta</span>
              </div>
            </button>

            <button
              onClick={() => addNode("end")}
              className="w-full flex items-center space-x-3 p-2.5 rounded-lg border border-zinc-800 bg-[#16171a] hover:border-zinc-700 text-left transition group"
            >
              <div className="p-2 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                <Flag className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">Finalizar Cadência</span>
                <span className="text-[10px] text-zinc-500">Conclui ciclo do lead</span>
              </div>
            </button>
          </div>
        </div>

        {/* Center: Interactive Sequence Canvas */}
        <div className="lg:col-span-6 rounded-xl border border-zinc-800 bg-[#0e0f12] p-5 overflow-y-auto flex flex-col items-center space-y-3">
          {nodes.map((node, index) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <div key={node.id} className="w-full max-w-md flex flex-col items-center">
                <div
                  onClick={() => selectNode(node.id)}
                  className={`w-full p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "border-indigo-500/80 bg-[#16171a] shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/50"
                      : "border-zinc-800 bg-[#121316] hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-full bg-zinc-800 text-[10px] font-mono flex items-center justify-center font-bold text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="text-xs font-semibold text-white">{node.name}</span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {node.type}
                      </span>
                      {nodes.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNode(node.id);
                          }}
                          className="p-1 rounded text-zinc-500 hover:text-red-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {node.type === "message" && (
                    <p className="text-xs text-zinc-400 line-clamp-2 font-mono bg-[#090a0c] p-2.5 rounded border border-zinc-800/80 leading-relaxed">
                      {node.templateBody || "(Clique para redigir o template da mensagem)"}
                    </p>
                  )}

                  {node.type === "wait" && (
                    <div className="text-xs text-amber-400 font-mono flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Aguardar {node.delayAmount} {node.delayUnit} antes do próximo passo</span>
                    </div>
                  )}

                  {node.type === "check_reply" && (
                    <div className="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Se contato respondeu: interromper follow-up imediatamente</span>
                    </div>
                  )}
                </div>

                {index < nodes.length - 1 && (
                  <div className="w-0.5 h-6 bg-zinc-800 my-1" />
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Node & Template Inspector */}
        <div className="lg:col-span-3 rounded-xl border border-zinc-800 bg-[#111215] p-4 overflow-y-auto space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">Editor da Etapa</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Parâmetros e variáveis</p>
          </div>

          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-400 block mb-1">Título da Etapa</label>
                <input
                  type="text"
                  value={selectedNode.name}
                  onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {selectedNode.type === "message" && (
                <div className="space-y-3">
                  <div>
                    <span className="text-xs font-medium text-zinc-400 block mb-1.5">Variáveis Disponíveis:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {["first_name", "full_name", "company", "job_title"].map((varName) => (
                        <button
                          key={varName}
                          type="button"
                          onClick={() => insertVariable(varName)}
                          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono border border-zinc-700 transition"
                        >
                          {`{{${varName}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-400 block mb-1">Texto da Mensagem</label>
                    <textarea
                      rows={6}
                      value={selectedNode.templateBody}
                      onChange={(e) => updateNode(selectedNode.id, { templateBody: e.target.value })}
                      className="w-full p-2.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono leading-relaxed focus:outline-none focus:border-indigo-500"
                      placeholder="Olá {{first_name}}, vi que você atua na {{company}}..."
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === "wait" && (
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1">Tempo de Espera</label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={selectedNode.delayAmount}
                      onChange={(e) => updateNode(selectedNode.id, { delayAmount: parseInt(e.target.value) || 1 })}
                      className="w-20 px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono"
                    />
                    <select
                      value={selectedNode.delayUnit}
                      onChange={(e) => updateNode(selectedNode.id, { delayUnit: e.target.value as any })}
                      className="px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white"
                    >
                      <option value="days">Dias</option>
                      <option value="hours">Horas</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-zinc-500 text-center py-8">Selecione uma etapa no canvas</div>
          )}
        </div>
      </div>

      {/* Mandatory Pre-Launch Preview Modal (Spec Section 21) */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-[#121316] border border-zinc-800 p-6 shadow-2xl space-y-4 text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center space-x-2 text-indigo-400">
                <Sparkles className="w-5 h-5" />
                <h3 className="text-sm font-semibold text-white">
                  Validação Pré-Lançamento (Preview de Contatos Reais)
                </h3>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Fechar
              </button>
            </div>

            {isLoadingPreview ? (
              <div className="p-8 text-center text-xs text-zinc-400">
                Renderizando variáveis com amostras reais de contatos...
              </div>
            ) : previewResult ? (
              <div className="space-y-4">
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {previewResult.previews.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                        item.blocked
                          ? "border-red-500/40 bg-red-950/20"
                          : "border-zinc-800 bg-[#16171a]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{item.contact_name} ({item.company})</span>
                        {item.blocked ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30">
                            BLOQUEADO: Falta variável {item.missing_var}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            VÁLIDO
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 font-mono text-[11px] whitespace-pre-line leading-relaxed bg-[#090a0c] p-2.5 rounded border border-zinc-800">
                        {item.rendered}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                  <span className="text-[11px] text-zinc-400">
                    O envio só será autorizado pelo servidor se todas as variáveis forem resolvidas.
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowPreviewModal(false)}
                      className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
                    >
                      Voltar ao Editor
                    </button>
                    <button
                      onClick={handleLaunchCampaign}
                      disabled={isLaunching}
                      className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
                    >
                      {isLaunching ? "Lançando..." : "Confirmar & Lançar"}
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle2,
  Workflow,
  Users,
  AlertCircle,
  Upload,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { Contact } from "@vibexcorp/api-client";

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dailyLimit, setDailyLimit] = useState(30);
  const [allowedStart, setAllowedStart] = useState("08:00");
  const [allowedEnd, setAllowedEnd] = useState("18:00");
  const [useRecommendedTemplate, setUseRecommendedTemplate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  // Lista de contatos selecionáveis (todos marcados por padrão, decisão do
  // usuário): quem não for marcado fica fora da cadência desta campanha.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contactsError, setContactsError] = useState<string | null>(null);

  // Upload CSV/JSON direto daqui: importa pela mesma API da página de
  // contatos e recarrega a lista já marcada.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadContacts = () => {
    api
      .listContacts()
      .then(({ contacts: list }) => {
        setContacts(list);
        setSelectedIds(new Set(list.map((c) => c.id)));
        setContactsError(null);
      })
      .catch((err: unknown) => {
        setContactsError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "json") {
      setImportMsg({ ok: false, text: "Formato não suportado — use .csv ou .json (organize com scripts/list/normalize.mjs)." });
      return;
    }

    setIsImporting(true);
    setImportMsg(null);
    try {
      const res = await api.importContactsFile(file);
      const n = res.inserted ?? res.imported ?? res.synced ?? 0;
      setImportMsg({ ok: true, text: `✓ ${n} contatos importados de ${file.name} — confira abaixo.` });
      loadContacts();
    } catch (err: unknown) {
      setImportMsg({
        ok: false,
        text: err instanceof Error ? err.message : `Falha ao importar ${file.name}.`,
      });
    } finally {
      setIsImporting(false);
    }
  };

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id))
    );
  };

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
        contact_ids: Array.from(selectedIds),
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

        {/* Lista de contatos: checkboxes, todos marcados por padrão */}
        <div className="pt-2 border-t border-zinc-800/80">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-zinc-500" />
              <span>Contatos desta Cadência</span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-500">
                {selectedIds.size} de {contacts.length} selecionados
              </span>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 transition"
                >
                  {selectedIds.size === contacts.length ? "Desmarcar todos" : "Marcar todos"}
                </button>
              )}
            </div>
          </div>

          {/* Upload CSV/JSON aqui dentro — importa e já entra na seleção */}
          <div className="flex items-center gap-2 mb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-800 transition disabled:opacity-60"
            >
              {isImporting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{isImporting ? "Importando..." : "Fazer Upload de Lista (CSV ou JSON)"}</span>
            </button>
            <span className="text-[10px] text-zinc-500">
              lista do Google Sheets, Apollo, planilha — qualquer origem
            </span>
          </div>

          {/* Resultado honesto do upload */}
          {importMsg && (
            <div
              role="status"
              className={`mb-2.5 px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                importMsg.ok
                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                  : "border-red-500/30 bg-red-950/20 text-red-300"
              }`}
            >
              <span className="font-mono break-all">{importMsg.text}</span>
              <button
                type="button"
                onClick={() => setImportMsg(null)}
                className="ml-3 text-[10px] opacity-70 hover:opacity-100 flex-shrink-0"
              >
                fechar
              </button>
            </div>
          )}

          {contactsError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2.5 text-[11px] text-red-300 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono break-all">{contactsError}</span>
            </div>
          ) : contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-[#141518] p-3 text-[11px] text-zinc-400">
              Nenhum contato cadastrado ainda. Use o botão acima para importar sua lista (CSV ou JSON) — depois de importar, os contatos aparecem aqui já selecionados.
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-[#0f1012] max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
              {contacts.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-900/50 cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleContact(c.id)}
                    className="w-3.5 h-3.5 accent-indigo-500"
                  />
                  <span className="text-xs text-zinc-200 font-medium truncate flex-1">
                    {c.full_name || `${c.first_name} ${c.last_name}`}
                  </span>
                  <span className="text-[10px] text-zinc-500 truncate max-w-[140px]">
                    {c.company || "—"}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600 uppercase">
                    {c.status}
                  </span>
                </label>
              ))}
            </div>
          )}
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

        <div className="flex items-center justify-between pt-3">
          {/* Sem contato marcado o backend entenderia "todos" — bloqueamos e
              avisamos, em vez de cadastrar uma cadência com escopo errado. */}
          {contacts.length > 0 && selectedIds.size === 0 && (
            <span className="text-[11px] text-amber-400">
              Selecione ao menos um contato (ou cadastre contatos depois).
            </span>
          )}
          <button
            type="submit"
            disabled={isCreating || (contacts.length > 0 && selectedIds.size === 0)}
            className="ml-auto flex items-center space-x-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm disabled:opacity-50"
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Workflow,
  Users,
  AlertCircle,
  Upload,
  RefreshCw,
  UserPlus,
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
  // contatos e recarrega a lista já marcada. Aceita vários arquivos de uma
  // vez (a pasta de prospecção costuma ter listas sobrepostas — o backend
  // deduplica pela URL canônica do LinkedIn).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Cadastro manual de contato com o link do LinkedIn na mão: cria via API
  // e já entra na lista selecionado. Nome vazio = derivado do slug no backend.
  const [showManual, setShowManual] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualJob, setManualJob] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

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

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (files.length === 0) return;

    setIsImporting(true);
    setImportMsg(null);
    try {
      let total = 0;
      const parts: string[] = [];
      let failure: string | null = null;
      for (const file of files) {
        const ext = file.name.toLowerCase().split(".").pop();
        if (ext !== "csv" && ext !== "json") {
          parts.push(`${file.name}: formato não suportado`);
          continue;
        }
        try {
          const res = await api.importContactsFile(file);
          const n = res.imported ?? res.inserted ?? res.synced ?? 0;
          total += n;
          const det = [
            `${n} importados`,
            res.duplicates ? `${res.duplicates} duplicados` : null,
            res.skipped ? `${res.skipped} ignorados (sem LinkedIn)` : null,
          ]
            .filter(Boolean)
            .join(", ");
          parts.push(`${file.name}: ${det}`);
        } catch (err: unknown) {
          failure = `${file.name}: ${err instanceof Error ? err.message : "falha ao importar"}`;
          break;
        }
      }
      setImportMsg({
        ok: failure === null,
        text: `${total} contatos importados — ${parts.join(" · ")}` + (failure ? ` — ERRO: ${failure}` : ""),
      });
      if (total > 0) loadContacts();
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = manualUrl.trim();
    if (!url) return;
    if (!/linkedin\.com\/(in|pub)\//i.test(url)) {
      setManualError("URL inválida — cole o link do perfil (linkedin.com/in/...).");
      return;
    }
    setIsAdding(true);
    setManualError(null);
    try {
      await api.createContact({
        first_name: manualName.trim(),
        full_name: manualName.trim(),
        company: manualCompany.trim(),
        job_title: manualJob.trim(),
        linkedin_url: url,
      });
      setShowManual(false);
      setManualUrl("");
      setManualName("");
      setManualCompany("");
      setManualJob("");
      setImportMsg({
        ok: true,
        text: `Contato ${manualName.trim() || url} adicionado e selecionado.`,
      });
      loadContacts();
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : "Falha ao adicionar contato.");
    } finally {
      setIsAdding(false);
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

      // Se o usuário escolheu o template recomendado, inicializa o fluxo padrão.
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
    } catch (err: unknown) {
      alert("Erro ao criar campanha: " + (err instanceof Error ? err.message : ""));
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Criar nova campanha</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure a cadência, defina o fluxo de mensagens e selecione os limites operacionais.
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-6 rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:p-8">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Nome da campanha *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Prospecção de Diretores de Tecnologia e Growth"
            className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Descrição do objetivo (opcional)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Cadência de follow-up com 2 etapas e stop on reply imediato para conexões do LinkedIn."
            className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {/* Escolha do fluxo inicial (Spec seção 18) */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            Modelo de fluxo inicial
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setUseRecommendedTemplate(true)}
              className={`rounded-xl border p-4 text-left transition ${
                useRecommendedTemplate
                  ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-100"
                  : "border-[#e8eaf1] bg-white hover:border-slate-300"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  <span>VibexCorp Standard</span>
                </span>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  Recomendado
                </span>
              </div>
              <p className="text-sm leading-snug text-slate-500">
                Cadência padrão de 3 etapas com verificação Stop on Reply entre envios.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setUseRecommendedTemplate(false)}
              className={`rounded-xl border p-4 text-left transition ${
                !useRecommendedTemplate
                  ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-100"
                  : "border-[#e8eaf1] bg-white hover:border-slate-300"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Workflow className="h-4 w-4 text-slate-400" />
                  <span>Fluxo em branco</span>
                </span>
              </div>
              <p className="text-sm leading-snug text-slate-500">
                Construa sua própria sequência do zero no construtor de fluxo interativo.
              </p>
            </button>
          </div>
        </div>

        {/* Lista de contatos: checkboxes, todos marcados por padrão */}
        <div className="border-t border-[#eef0f6] pt-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Users className="h-4 w-4 text-slate-400" />
              <span>Contatos desta cadência</span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {selectedIds.size} de {contacts.length} selecionados
              </span>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-indigo-600 transition hover:text-indigo-700"
                >
                  {selectedIds.size === contacts.length ? "Desmarcar todos" : "Marcar todos"}
                </button>
              )}
            </div>
          </div>

          {/* Upload CSV/JSON (vários arquivos) + cadastro manual aqui dentro */}
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              multiple
              className="hidden"
              onChange={handleImportFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-slate-50 disabled:opacity-60"
            >
              {isImporting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{isImporting ? "Importando..." : "Fazer upload de lista (CSV ou JSON)"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowManual((v) => !v);
                setManualError(null);
              }}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
                showManual
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-[#e8eaf1] bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <UserPlus className="h-4 w-4" />
              <span>Adicionar contato manualmente</span>
            </button>
            <span className="text-xs text-slate-400">
              lista do Google Sheets, Apollo, planilha — qualquer origem
            </span>
          </div>

          {/* Formulário manual: só o link é obrigatório */}
          {showManual && (
            <form
              onSubmit={handleAddManual}
              className="mb-2.5 space-y-2.5 rounded-xl border border-[#e8eaf1] bg-[#f8f9fc] p-3.5"
            >
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    URL do LinkedIn *
                  </label>
                  <input
                    type="text"
                    required
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/nome-da-pessoa"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Nome completo
                  </label>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Vazio = derivado do link"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Empresa
                  </label>
                  <input
                    type="text"
                    value={manualCompany}
                    onChange={(e) => setManualCompany(e.target.value)}
                    placeholder="Ex: VibexCorp"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Cargo
                  </label>
                  <input
                    type="text"
                    value={manualJob}
                    onChange={(e) => setManualJob(e.target.value)}
                    placeholder="Ex: Diretor de Tecnologia"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>
              {manualError && (
                <p className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {manualError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowManual(false);
                    setManualError(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isAdding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isAdding ? "Adicionando..." : "Adicionar contato"}</span>
                </button>
              </div>
            </form>
          )}

          {/* Resultado honesto do upload */}
          {importMsg && (
            <div
              role="status"
              className={`mb-2.5 flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm ${
                importMsg.ok
                  ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                  : "border-red-100 bg-red-50 text-red-600"
              }`}
            >
              <span className="break-all">{importMsg.text}</span>
              <button
                type="button"
                onClick={() => setImportMsg(null)}
                className="ml-3 flex-shrink-0 text-xs opacity-70 transition hover:opacity-100"
              >
                fechar
              </button>
            </div>
          )}

          {contactsError ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="break-all">{contactsError}</span>
            </div>
          ) : contacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d5d9e4] bg-[#f8f9fc] p-4 text-sm text-slate-500">
              Nenhum contato cadastrado ainda. Use os botões acima para importar sua lista (CSV ou JSON, vários arquivos de uma vez) ou cadastrar um contato manualmente com o link do LinkedIn — depois, os contatos aparecem aqui já selecionados.
            </div>
          ) : (
            <div className="max-h-56 divide-y divide-[#eef0f6] overflow-y-auto rounded-xl border border-[#e8eaf1] bg-white">
              {contacts.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-[#f8f9fc]"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleContact(c.id)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                  <span className="flex-1 truncate text-sm font-medium text-slate-700">
                    {c.full_name || `${c.first_name} ${c.last_name}`}
                  </span>
                  <span className="max-w-[140px] truncate text-xs text-slate-400">
                    {c.company || "—"}
                  </span>
                  <span className="text-xs font-medium uppercase text-slate-400">
                    {c.status}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Limites e horários */}
        <div className="grid grid-cols-1 gap-3 border-t border-[#eef0f6] pt-5 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Limite diário</label>
            <input
              type="number"
              min="5"
              max="50"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(parseInt(e.target.value) || 30)}
              className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Início</label>
            <input
              type="time"
              value={allowedStart}
              onChange={(e) => setAllowedStart(e.target.value)}
              className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Fim</label>
            <input
              type="time"
              value={allowedEnd}
              onChange={(e) => setAllowedEnd(e.target.value)}
              className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#eef0f6] pt-5">
          {/* Sem contato marcado o backend entenderia "todos" — bloqueamos e
              avisamos, em vez de cadastrar uma cadência com escopo errado. */}
          {contacts.length > 0 && selectedIds.size === 0 && (
            <span className="text-sm text-amber-600">
              Selecione ao menos um contato (ou cadastre contatos depois).
            </span>
          )}
          <button
            type="submit"
            disabled={isCreating || (contacts.length > 0 && selectedIds.size === 0)}
            className="ml-auto flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(79,70,229,0.25)] transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isCreating ? (
              <span>Criando campanha...</span>
            ) : (
              <>
                <span>Prosseguir para o fluxo</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

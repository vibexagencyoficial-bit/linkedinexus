"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  Upload,
  UserPlus,
  RefreshCw,
  ExternalLink,
  Users,
  Trash2,
  Linkedin,
} from "lucide-react";
import { api } from "@/lib/api";
import { Contact } from "@vibexcorp/api-client";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "waiting", label: "Aguardando disparo" },
  { id: "contacted", label: "Mensagem enviada" },
  { id: "replied", label: "Responderam" },
  { id: "completed", label: "Concluídos" },
];

function statusBadge(status: string) {
  if (status === "replied")
    return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "contacted")
    return "bg-indigo-50 text-indigo-700 border-indigo-100";
  if (status === "waiting")
    return "bg-amber-50 text-amber-700 border-amber-100";
  if (status === "active") return "bg-sky-50 text-sky-700 border-sky-100";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusLabel(status: string) {
  if (status === "contacted") return "Mensagem enviada";
  if (status === "waiting") return "Aguardando disparo";
  if (status === "replied") return "Respondeu";
  return status;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modais
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Formulário de novo contato
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Sync rápido (conexões reais do LinkedIn)
  const [syncBatchText, setSyncBatchText] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  // Upload de arquivo (CSV/JSON) — pipeline real: multipart → backend →
  // dedupe → Postgres. Mensagem honesta de resultado/erro.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "json") {
      setImportMsg({ ok: false, text: "Formato não suportado — use .csv ou .json." });
      return;
    }

    setIsImporting(true);
    setImportMsg(null);
    try {
      const res = await api.importContactsFile(file);
      const n = res.inserted ?? res.imported ?? res.synced ?? 0;
      setImportMsg({ ok: true, text: `${n} contatos importados de ${file.name}.` });
      await loadContacts();
    } catch (err: unknown) {
      setImportMsg({
        ok: false,
        text: err instanceof Error ? err.message : `Falha ao importar ${file.name}.`,
      });
    } finally {
      setIsImporting(false);
    }
  };

  const loadContacts = async () => {
    setIsLoading(true);
    try {
      const filter = activeFilter === "all" ? undefined : activeFilter;
      const res = await api.listContacts(filter, searchQuery || undefined);
      setContacts(res.contacts || []);
    } catch {
      setContacts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, [activeFilter, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === contacts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(contacts.map((c) => c.id));
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkedinUrl) return;
    setIsSaving(true);
    try {
      await api.createContact({
        first_name: firstName,
        last_name: lastName,
        company: company,
        job_title: jobTitle,
        linkedin_url: linkedinUrl,
      });
      setShowAddModal(false);
      setFirstName("");
      setLastName("");
      setCompany("");
      setJobTitle("");
      setLinkedinUrl("");
      await loadContacts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao salvar contato.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncRealConnections = async () => {
    setIsSyncing(true);
    try {
      // Parse manual da lista de conexões colada pelo operador.
      const lines = syncBatchText.split("\n").filter((l) => l.trim().length > 0);
      const parsed = lines.map((line) => {
        const parts = line.split(",").map((p) => p.trim());
        const nameParts = (parts[0] || "").split(" ");
        return {
          first_name: nameParts[0] || "Conexão",
          last_name: nameParts.slice(1).join(" ") || "",
          company: parts[1] || "LinkedIn",
          job_title: parts[2] || "Profissional",
          linkedin_url: parts[3] || `https://linkedin.com/in/${(parts[0] || "profile").toLowerCase().replace(/\s+/g, "-")}`,
        };
      });

      if (parsed.length > 0) {
        await api.syncLinkedInContacts(parsed);
      }
      setShowSyncModal(false);
      setSyncBatchText("");
      await loadContacts();
    } catch (err: unknown) {
      alert("Erro ao sincronizar conexões: " + (err instanceof Error ? err.message : ""));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Deseja remover ${selectedIds.length} contato(s)?`)) return;
    for (const id of selectedIds) {
      await api.deleteContact(id).catch(() => null);
    }
    setSelectedIds([]);
    await loadContacts();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Cabeçalho da página */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Contatos & Conexões</h2>
          <p className="mt-1 text-sm text-slate-500">
            Base unificada com deduplicação nativa por URL do LinkedIn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 rounded-lg border border-[#e8eaf1] bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-slate-50 disabled:opacity-60"
          >
            {isImporting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span>{isImporting ? "Importando..." : "Importar CSV/JSON"}</span>
          </button>

          <button
            onClick={() => setShowSyncModal(true)}
            className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3.5 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
          >
            <Linkedin className="h-4 w-4" />
            <span>Sincronizar conexões</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(79,70,229,0.25)] transition hover:bg-indigo-700"
          >
            <UserPlus className="h-4 w-4" />
            <span>Novo contato</span>
          </button>
        </div>
      </div>

      {/* Resultado honesto do upload (imported/skipped ou erro real) */}
      {importMsg && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
            importMsg.ok
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border-red-100 bg-red-50 text-red-600"
          }`}
        >
          <span className="break-all">{importMsg.text}</span>
          <button
            onClick={() => setImportMsg(null)}
            className="ml-3 flex-shrink-0 text-xs opacity-70 transition hover:opacity-100"
          >
            fechar
          </button>
        </div>
      )}

      {/* Busca e filtros */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#e8eaf1] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome ou empresa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="flex w-full items-center gap-1 overflow-x-auto sm:w-auto">
          {FILTERS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                activeFilter === tab.id
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={loadContacts}
            title="Atualizar"
            className="ml-1 rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Barra de ação em lote */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700">
          <span>{selectedIds.length} contato(s) selecionado(s)</span>
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" />
            <span>Remover selecionados</span>
          </button>
        </div>
      )}

      {/* Tabela de contatos */}
      <div className="overflow-hidden rounded-2xl border border-[#e8eaf1] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-14 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
            <span>Carregando contatos...</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-3 p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e8eaf1] bg-[#f4f5fa] text-slate-400">
              <Users className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900">Nenhum contato encontrado</h3>
              <p className="max-w-sm text-sm text-slate-500">
                Cadastre contatos manualmente, importe um arquivo CSV/JSON ou sincronize as conexões do seu LinkedIn.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setShowSyncModal(true)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
              >
                Sincronizar conexões
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="rounded-lg border border-[#e8eaf1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Adicionar manualmente
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="border-b border-[#e8eaf1] bg-[#f8f9fc] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 p-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === contacts.length && contacts.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded accent-indigo-600"
                    />
                  </th>
                  <th className="p-4">Nome</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Cargo</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">LinkedIn</th>
                  <th className="p-4">Mensagens</th>
                  <th className="p-4 text-right">Cadastrado em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef0f6]">
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className={`transition-colors hover:bg-[#f8f9fc] ${
                      selectedIds.includes(c.id) ? "bg-indigo-50/50" : ""
                    }`}
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded accent-indigo-600"
                      />
                    </td>
                    <td className="p-4 font-semibold text-slate-900">
                      {c.full_name || `${c.first_name} ${c.last_name}`}
                    </td>
                    <td className="p-4">{c.company || "—"}</td>
                    <td className="p-4">{c.job_title || "—"}</td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge(c.status)}`}
                      >
                        {statusLabel(c.status)}
                      </span>
                    </td>
                    <td className="p-4">
                      <a
                        href={c.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-indigo-600 hover:underline"
                      >
                        <span className="max-w-[140px] truncate">
                          {c.linkedin_url
                            .replace("https://linkedin.com/in/", "")
                            .replace("https://www.linkedin.com/in/", "")}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                      </a>
                    </td>
                    <td className="p-4">
                      {c.status === "contacted" || c.status === "replied" ? (
                        <a
                          href="/inbox"
                          className="font-medium text-indigo-600 transition hover:text-indigo-700"
                        >
                          Ver na caixa de entrada
                        </a>
                      ) : (
                        <span className="text-slate-400">Aguardando fila</span>
                      )}
                    </td>
                    <td className="p-4 text-right text-slate-400">
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: novo contato */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Cadastrar novo contato</h3>

            <form onSubmit={handleCreateContact} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Primeiro nome</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Marcos"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Sobrenome</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Silva"
                    className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Empresa</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="VibexCorp"
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Cargo</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Head de Growth"
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">URL do LinkedIn *</label>
                <input
                  type="url"
                  required
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/nome-usuario"
                  className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[#e8eaf1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSaving ? "Salvando..." : "Salvar contato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: sincronizar conexões reais */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <Linkedin className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Sincronizar conexões do LinkedIn</h3>
                <p className="text-sm text-slate-500">
                  Importação em lote de conexões de 1º grau para outreach.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-600">
                Cole as conexões (formato: Nome, Empresa, Cargo, URL) ou sincronize automaticamente pela extensão:
              </label>
              <textarea
                rows={5}
                value={syncBatchText}
                onChange={(e) => setSyncBatchText(e.target.value)}
                placeholder={"Exemplo:\nLucas Silva, VibexCorp, CTO, https://linkedin.com/in/lucas-silva\nMariana Costa, Fintech Inc, VP de Vendas, https://linkedin.com/in/mariana-costa"}
                className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] p-3 font-mono text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <span className="block text-xs text-slate-400">
                Com a extensão do navegador instalada, suas conexões são capturadas diretamente da página de conexões do LinkedIn em 1 clique (veja Configurações &gt; Extensão).
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                className="rounded-lg border border-[#e8eaf1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={isSyncing || !syncBatchText.trim()}
                onClick={handleSyncRealConnections}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSyncing ? "Sincronizando..." : "Sincronizar conexões"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

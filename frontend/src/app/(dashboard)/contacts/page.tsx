"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  Upload,
  UserPlus,
  RefreshCw,
  ExternalLink,
  Users,
  CheckCircle2,
  Trash2,
  Linkedin,
} from "lucide-react";
import { api } from "@/lib/api";
import { Contact } from "@vibexcorp/api-client";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // New Contact Form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Quick Sync Form (Real LinkedIn Connections)
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
      setImportMsg({ ok: false, text: "Formato não suportado — use .csv ou .json (veja scripts/list/normalize.mjs)." });
      return;
    }

    setIsImporting(true);
    setImportMsg(null);
    try {
      const res = await api.importContactsFile(file);
      const n = res.inserted ?? res.imported ?? res.synced ?? 0;
      setImportMsg({ ok: true, text: `✓ ${n} contatos importados de ${file.name}.` });
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
    } catch (err: any) {
      alert(err?.message || "Erro ao salvar contato.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncRealConnections = async () => {
    setIsSyncing(true);
    try {
      // Parse manual or extension list of connections
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
    } catch (err: any) {
      alert("Erro ao sincronizar conexões: " + (err?.message || ""));
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
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Contatos & Conexões</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Base de dados unificada com deduplicação nativa por URL do LinkedIn.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-800 transition disabled:opacity-60"
          >
            {isImporting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>{isImporting ? "Importando..." : "Importar CSV/JSON"}</span>
          </button>

          <button
            onClick={() => setShowSyncModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-[#0077b5]/30 bg-[#0077b5]/10 text-xs font-medium text-[#38bdf8] hover:bg-[#0077b5]/20 transition"
          >
            <Linkedin className="w-3.5 h-3.5" />
            <span>Sincronizar Conexões LinkedIn</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Novo Contato</span>
          </button>
        </div>
      </div>

      {/* Resultado honesto do upload (imported/skipped ou erro real) */}
      {importMsg && (
        <div
          role="status"
          className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
            importMsg.ok
              ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
              : "border-red-500/30 bg-red-950/20 text-red-300"
          }`}
        >
          <span className="font-mono break-all">{importMsg.text}</span>
          <button
            onClick={() => setImportMsg(null)}
            className="ml-3 text-[10px] opacity-70 hover:opacity-100 flex-shrink-0"
          >
            fechar
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2.5 rounded-lg border border-zinc-800 bg-[#111215]">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Filtrar por nome ou empresa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#16171a] border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto">
          {[
            { id: "all", label: "Todos" },
            { id: "waiting", label: "Aguardando Disparo" },
            { id: "contacted", label: "Mensagem Enviada" },
            { id: "replied", label: "Responderam" },
            { id: "completed", label: "Concluídos" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                activeFilter === tab.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={loadContacts}
            title="Atualizar"
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Floating Batch Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg border border-indigo-500/30 bg-indigo-950/20 text-xs text-indigo-200">
          <span>{selectedIds.length} contato(s) selecionado(s)</span>
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white transition text-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remover Selecionados</span>
          </button>
        </div>
      )}

      {/* Contacts Table (Attio high density) */}
      <div className="rounded-xl border border-zinc-800 bg-[#111215] overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
            <span>Carregando contatos reais...</span>
          </div>
        ) : contacts.length === 0 ? (
          /* Attio-Style Clean Empty State (Zero imaginary data) */
          <div className="p-16 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">Nenhum contato encontrado</h3>
              <p className="text-xs text-zinc-400 max-w-sm">
                Sua base de dados está pronta. Cadastre contatos manualmente ou sincronize diretamente as conexões do seu LinkedIn.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setShowSyncModal(true)}
                className="px-3.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm"
              >
                Sincronizar Conexões
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3.5 py-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 text-xs font-medium text-zinc-300 hover:text-white transition"
              >
                Adicionar Contato Manual
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-[#141518] text-[11px] uppercase tracking-wider text-zinc-400 font-mono border-b border-zinc-800">
                <tr>
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === contacts.length && contacts.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded accent-indigo-500"
                    />
                  </th>
                  <th className="p-3">Nome Completo</th>
                  <th className="p-3">Empresa</th>
                  <th className="p-3">Cargo</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">LinkedIn URL</th>
                  <th className="p-3">Ações / Inbox</th>
                  <th className="p-3 text-right">Cadastrado em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className={`hover:bg-zinc-800/30 transition-colors ${
                      selectedIds.includes(c.id) ? "bg-indigo-950/10" : ""
                    }`}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded accent-indigo-500"
                      />
                    </td>
                    <td className="p-3 font-medium text-white">{c.full_name || `${c.first_name} ${c.last_name}`}</td>
                    <td className="p-3 text-zinc-300">{c.company || "—"}</td>
                    <td className="p-3 text-zinc-400">{c.job_title || "—"}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          c.status === "replied"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : c.status === "contacted"
                            ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                            : c.status === "waiting"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : c.status === "active"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {c.status === "contacted"
                          ? "Mensagem Enviada"
                          : c.status === "waiting"
                          ? "Aguardando Disparo"
                          : c.status === "replied"
                          ? "Respondeu"
                          : c.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <a
                        href={c.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                      >
                        <span className="truncate max-w-[140px]">{c.linkedin_url.replace("https://linkedin.com/in/", "").replace("https://www.linkedin.com/in/", "")}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </td>
                    <td className="p-3">
                      {(c.status === "contacted" || c.status === "replied") ? (
                        <a
                          href="/inbox"
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                        >
                          <span>💬 Ver na Inbox</span>
                        </a>
                      ) : (
                        <span className="text-[10px] text-zinc-500 font-mono">Fila de espera</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-zinc-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Novo Contato */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#121316] p-6 shadow-2xl text-zinc-100 space-y-4">
            <h3 className="text-sm font-semibold text-white">Cadastrar Novo Contato</h3>

            <form onSubmit={handleCreateContact} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Primeiro Nome</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Marcos"
                    className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Sobrenome</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Dardi"
                    className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Empresa</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="VibexCorp"
                  className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Cargo</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Head of Growth"
                  className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">URL do LinkedIn *</label>
                <input
                  type="url"
                  required
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/nome-usuario"
                  className="w-full px-3 py-1.5 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {isSaving ? "Salvando..." : "Salvar Contato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Sincronizar Conexões Reais */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-[#121316] p-6 shadow-2xl text-zinc-100 space-y-4">
            <div className="flex items-center space-x-3 text-white">
              <div className="w-8 h-8 rounded-lg bg-[#0077b5]/10 border border-[#0077b5]/30 flex items-center justify-center text-[#0077b5]">
                <Linkedin className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Sincronizar Conexões do LinkedIn</h3>
                <p className="text-xs text-zinc-400">Importação em lote de conexões de 1º grau para outreach.</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-300">
                Cole linhas de conexões (Formato: Nome, Empresa, Cargo, URL) ou sincronize automaticamente via Extensão:
              </label>
              <textarea
                rows={5}
                value={syncBatchText}
                onChange={(e) => setSyncBatchText(e.target.value)}
                placeholder="Exemplo:&#10;Lucas Silva, VibexCorp, CTO, https://linkedin.com/in/lucas-silva&#10;Mariana Costa, Fintech Inc, VP de Vendas, https://linkedin.com/in/mariana-costa"
                className="w-full p-3 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] text-zinc-500 block">
                Ao utilizar a extensão de navegador, suas conexões são capturadas diretamente da página de conexões do LinkedIn com 1 clique.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={isSyncing || !syncBatchText.trim()}
                onClick={handleSyncRealConnections}
                className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {isSyncing ? "Sincronizando..." : "Sincronizar Conexões"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

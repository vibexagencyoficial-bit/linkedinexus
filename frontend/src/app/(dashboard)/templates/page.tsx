"use client";

import { useEffect, useState } from "react";
import { Plus, Eye, Copy, Check, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

export default function TemplatesPage() {
  const [templateBody, setTemplateBody] = useState(
    "Olá {{first_name}}, vi que você atua na {{company}} como {{job_title}} e queria trocar uma ideia rápida..."
  );

  const [copied, setCopied] = useState(false);
  const [renderedText, setRenderedText] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [missingVars, setMissingVars] = useState<string[]>([]);

  // Contato de exemplo editável para testar variáveis (Fase E: rotulado
  // como exemplo — nunca é persistido nem exibido como contato real).
  const [testContact, setTestContact] = useState({
    first_name: "",
    full_name: "",
    company: "",
    job_title: "",
  });

  const insertVariable = (varName: string) => {
    setTemplateBody((prev) => prev + " {{" + varName + "}}");
  };

  useEffect(() => {
    // Chama o endpoint real de preview
    api.previewTemplate(templateBody, testContact)
      .then((res) => {
        setRenderedText(res.rendered_text);
        setNeedsReview(res.needs_review);
        setMissingVars(res.missing_vars || []);
      })
      .catch(() => {
        // Fallback local com substituição por regex
        let text = templateBody;
        const missing: string[] = [];
        const matches = templateBody.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g);
        for (const match of matches) {
          const key = match[1];
          const val = (testContact as Record<string, string>)[key];
          if (!val) {
            missing.push(key);
          } else {
            text = text.replace(match[0], val);
          }
        }
        setRenderedText(text);
        setNeedsReview(missing.length > 0);
        setMissingVars(missing);
      });
  }, [templateBody, testContact]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Editor e validador de templates</h2>
        <p className="mt-1 text-sm text-slate-500">
          Crie mensagens com resolução segura de variáveis. Se um dado obrigatório estiver ausente, o envio é bloqueado como needs_review.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Esquerda: editor do template */}
        <div className="space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Corpo da mensagem</h3>
            <span className="text-xs text-slate-400">Variáveis suportadas</span>
          </div>

          {/* Botões de inserção rápida */}
          <div className="flex flex-wrap gap-1.5">
            {["first_name", "full_name", "company", "job_title"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="flex items-center gap-1 rounded-md border border-[#e8eaf1] bg-[#f4f5fa] px-2 py-1 font-mono text-xs text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Plus className="h-3 w-3" />
                <span>{`{{${v}}}`}</span>
              </button>
            ))}
          </div>

          <textarea
            rows={8}
            value={templateBody}
            onChange={(e) => setTemplateBody(e.target.value)}
            className="w-full rounded-lg border border-[#e8eaf1] bg-[#f4f5fa] p-3 font-mono text-sm leading-relaxed text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="Digite o texto com tags dinâmicas..."
          />

          <div className="flex items-center justify-between pt-1 text-sm text-slate-400">
            <span>{templateBody.length} caracteres</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(templateBody);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 text-slate-500 transition hover:text-slate-700"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? "Copiado!" : "Copiar texto"}</span>
            </button>
          </div>
        </div>

        {/* Direita: preview em tempo real */}
        <div className="space-y-4 rounded-2xl border border-[#e8eaf1] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-indigo-600">
              <Eye className="h-4 w-4" />
              <h3 className="text-sm font-semibold text-slate-900">Preview dinâmico</h3>
            </div>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                needsReview
                  ? "border-red-200 bg-red-50 text-red-600"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {needsReview ? "Needs review" : "Resolvido"}
            </span>
          </div>

          {/* Dados de teste */}
          <div className="space-y-2 rounded-xl border border-[#eef0f6] bg-[#f8f9fc] p-3.5">
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              Dados de teste (exemplo — nunca é persistido)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="first_name"
                value={testContact.first_name}
                onChange={(e) => setTestContact({ ...testContact, first_name: e.target.value })}
                className="rounded-lg border border-[#e8eaf1] bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <input
                type="text"
                placeholder="company"
                value={testContact.company}
                onChange={(e) => setTestContact({ ...testContact, company: e.target.value })}
                className="rounded-lg border border-[#e8eaf1] bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          {/* Texto renderizado */}
          <div className="whitespace-pre-line rounded-xl border border-[#eef0f6] bg-[#f8f9fc] p-3.5 font-mono text-sm leading-relaxed text-slate-600">
            {renderedText || "(Template vazio)"}
          </div>

          {needsReview && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>Variável ausente: {missingVars.join(", ")}. O envio seria bloqueado.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

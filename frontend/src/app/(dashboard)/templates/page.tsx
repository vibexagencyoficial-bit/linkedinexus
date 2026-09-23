"use client";

import { useEffect, useState } from "react";
import { Plus, Eye, Sparkles, Copy, Check, AlertCircle } from "lucide-react";
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
    // Call real preview endpoint
    api.previewTemplate(templateBody, testContact)
      .then((res) => {
        setRenderedText(res.rendered_text);
        setNeedsReview(res.needs_review);
        setMissingVars(res.missing_vars || []);
      })
      .catch(() => {
        // Fallback local regex replacement
        let text = templateBody;
        const missing: string[] = [];
        const matches = templateBody.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g);
        for (const match of matches) {
          const key = match[1];
          const val = (testContact as any)[key];
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Editor & Validador de Templates</h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Crie mensagens com resolução segura de variáveis. Se um dado obrigatório estiver ausente, o envio é bloqueado como needs_review.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left: Template Editor */}
        <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-white">Corpo da Mensagem</h2>
            <span className="text-[10px] font-mono text-zinc-400">Variáveis Suportadas</span>
          </div>

          {/* Quick Insert Pills */}
          <div className="flex flex-wrap gap-1.5">
            {["first_name", "full_name", "company", "job_title"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono border border-zinc-700 transition flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>{`{{${v}}}`}</span>
              </button>
            ))}
          </div>

          <textarea
            rows={8}
            value={templateBody}
            onChange={(e) => setTemplateBody(e.target.value)}
            className="w-full p-3 text-xs bg-[#18191c] border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-indigo-500 leading-relaxed"
            placeholder="Digite o texto com tags dinâmicas..."
          />

          <div className="flex justify-between items-center text-xs text-zinc-500 pt-1">
            <span>{templateBody.length} caracteres</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(templateBody);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center space-x-1 text-zinc-400 hover:text-white transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copiado!" : "Copiar Texto"}</span>
            </button>
          </div>
        </div>

        {/* Right: Real-time Live Preview */}
        <div className="rounded-xl border border-zinc-800 bg-[#111215] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-indigo-400">
              <Eye className="w-4 h-4" />
              <h2 className="text-xs font-semibold text-white">Preview Dinâmico</h2>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                needsReview
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              }`}
            >
              {needsReview ? "NEEDS REVIEW" : "RESOLVIDO"}
            </span>
          </div>

          {/* Test Contact inputs */}
          <div className="p-3 rounded-lg bg-[#16171a] border border-zinc-800/80 space-y-2">
            <span className="text-[10px] text-zinc-400 font-mono uppercase block">Dados de Teste:</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input
                type="text"
                placeholder="first_name"
                value={testContact.first_name}
                onChange={(e) => setTestContact({ ...testContact, first_name: e.target.value })}
                className="px-2 py-1 bg-[#121316] border border-zinc-800 rounded text-xs text-white"
              />
              <input
                type="text"
                placeholder="company"
                value={testContact.company}
                onChange={(e) => setTestContact({ ...testContact, company: e.target.value })}
                className="px-2 py-1 bg-[#121316] border border-zinc-800 rounded text-xs text-white"
              />
            </div>
          </div>

          {/* Rendered Text */}
          <div className="p-3.5 rounded-lg bg-[#0e0f12] border border-zinc-800 text-xs font-mono whitespace-pre-line leading-relaxed text-zinc-200">
            {renderedText || "(Template vazio)"}
          </div>

          {needsReview && (
            <div className="flex items-center gap-1.5 p-2 rounded bg-red-950/30 border border-red-500/30 text-xs text-red-300">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Variável ausente: {missingVars.join(", ")}. O envio seria bloqueado.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

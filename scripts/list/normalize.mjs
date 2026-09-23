#!/usr/bin/env node
/**
 * VibexCorp — Organizador de Listas de Contatos (normalize.mjs)
 *
 * Lê uma lista bagunçada de contatos (CSV ou JSON — Google Sheets, Apollo,
 * planilha exportada, etc.), infere e limpa os campos, remove duplicatas e
 * gera os arquivos prontos para o upload no painel:
 *
 *   node scripts/list/normalize.mjs lista-baguncada.csv
 *   node scripts/list/normalize.mjs lista.json -o ./saida
 *
 * Saída (em -o ou ./normalizados):
 *   contatos-<timestamp>.json  → array de contatos prontos (upload JSON)
 *   contatos-<timestamp>.csv   → Full Name, Company, Job Title, LinkedIn URL
 *
 * Zero dependências — roda com qualquer Node 18+.
 */

import fs from "node:fs";
import path from "node:path";

// ---------- utilidades ----------

const stripBom = (s) => s.replace(/^\uFEFF/, "");
const collapseWs = (s) => s.replace(/\s+/g, " ").trim();
const clean = (s) =>
  collapseWs(String(s ?? ""))
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .trim();

function die(msg) {
  console.error(`[normalize] ERRO: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { input: null, out: "./normalizados" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "--out") {
      args.out = argv[++i] ?? args.out;
    } else if (!args.input) {
      args.input = argv[i];
    }
  }
  return args;
}

// ---------- CSV (dialecto tolerante: vírgula, ponto-e-vírgula ou TAB) ----------

function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = {
    ",": (line.match(/,/g) || []).length,
    ";": (line.match(/;/g) || []).length,
    "\t": (line.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

// Parser RFC-4180 simplificado: aspas duplas, delimitador/quebra dentro de campo.
function parseCSV(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(h) {
  return clean(stripBom(h))
    .toLowerCase()
    .replace(/[\s.\-/]+/g, "_")
    .replace(/[^a-z0-9_à-ÿ]/g, "");
}

// Aliases aceitos por coluna (pt-BR e en; mesmos aliases do backend).
const ALIASES = {
  full_name: ["full_name", "fullname", "name", "nome", "nome_completo", "contato", "lead", "contact"],
  first_name: ["first_name", "firstname", "nome", "prenome"],
  last_name: ["last_name", "lastname", "sobrenome"],
  company: ["company", "empresa", "companhia", "organizacao", "organization", "account", "conta"],
  job_title: ["job_title", "jobtitle", "title", "cargo", "funcao", "occupation", "position", "titulo"],
  linkedin_url: [
    "linkedin_url", "linkedin", "url_do_linkedin", "url", "link",
    "profile", "perfil", "profile_url", "linkedin_profile", "li_url",
    "perfil_do_linkedin", "url_do_perfil", "linkedin_do_perfil",
  ],
};

function mapHeaders(headerRow) {
  const idx = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const at = normalized.indexOf(alias);
      if (at !== -1 && !Object.values(idx).includes(at)) {
        idx[field] = at;
        break;
      }
    }
  }
  // Fallback fuzzy para a URL: cabeçalhos do mundo real variam ("Perfil do
  // LinkedIn", "Página", "Link do perfil") — pega a primeira coluna cujo
  // nome sugere LinkedIn/perfil e ainda não foi usada.
  if (idx.linkedin_url === undefined) {
    const at = normalized.findIndex(
      (h, i) =>
        !Object.values(idx).includes(i) &&
        (h.includes("linkedin") || h.includes("perfil") || h.includes("profile") || h.endsWith("url") || h === "url" || h === "link")
    );
    if (at !== -1) idx.linkedin_url = at;
  }
  return idx;
}

// ---------- normalização de contatos ----------

function normalizeUrl(raw) {
  let u = clean(raw);
  if (!u) return "";
  if (/^(www\.)?linkedin\.com\//i.test(u)) u = `https://${u}`;
  if (/^linkedin\.com\//i.test(u)) u = `https://www.${u}`;
  if (!/^https?:\/\//i.test(u) && /linkedin\.com/i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    parsed.search = "";
    parsed.hash = "";
    let out = parsed.toString();
    out = out.replace(/\/+$/, ""); // barra final
    if (!/linkedin\.com\/in\//i.test(out)) return ""; // não é perfil de pessoa
    return out;
  } catch {
    return "";
  }
}

function splitFullName(full) {
  const parts = clean(full).split(" ").filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Linha canônica: [full, first, last, company, job, url]
const IDX = { full_name: 0, first_name: 1, last_name: 2, company: 3, job_title: 4, linkedin_url: 5 };

function toContact(row, report) {
  const get = (field) => (row[IDX[field]] != null ? clean(row[IDX[field]]) : "");

  let full = get("full_name");
  let first = get("first_name");
  let last = get("last_name");
  const company = get("company") || "—";
  const job = get("job_title") || "—";
  const url = normalizeUrl(get("linkedin_url"));

  // compõe nome completo a partir de first+last
  if (!full && (first || last)) full = collapseWs(`${first} ${last}`);
  // exportações comuns vêm como "Sobrenome, Nome" — inverte para "Nome Sobrenome"
  const inverted = full.match(/^([^,]+),\s*(.+)$/);
  if (inverted) full = collapseWs(`${inverted[2]} ${inverted[1]}`);
  // decompõe full em first/last quando só existe o completo
  if (full && !first) {
    const split = splitFullName(full);
    first = split.first;
    if (!last) last = split.last;
  }

  if (!full && !first) {
    report.semNome++;
    return null;
  }
  if (!url) {
    report.semUrl++;
    return null;
  }
  if (!full) full = first;

  return {
    first_name: first || full,
    last_name: last || "",
    full_name: full,
    company,
    job_title: job,
    linkedin_url: url,
  };
}

// ---------- entrada: CSV ou JSON → linhas canônicas ----------

function loadRows(inputPath) {
  const rawText = stripBom(fs.readFileSync(inputPath, "utf8"));
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === ".json") {
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      die(`JSON inválido: ${e.message}`);
    }
    const arr = Array.isArray(data) ? data : data?.connections ?? data?.contacts ?? data?.data;
    if (!Array.isArray(arr)) die("JSON precisa ser um array de contatos ou {connections:[...]}.");

    return arr.map((obj) => {
      const lower = {};
      for (const [k, v] of Object.entries(obj ?? {})) {
        lower[normalizeHeader(k)] = v == null ? "" : String(v);
      }
      const pick = (...aliases) => {
        for (const a of aliases) {
          if (lower[a] !== undefined && clean(lower[a]) !== "") return lower[a];
        }
        return "";
      };
      return [
        pick("full_name", "fullname", "name", "nome", "nome_completo", "contato"),
        pick("first_name", "firstname", "nome", "prenome"),
        pick("last_name", "lastname", "sobrenome"),
        pick("company", "empresa", "organizacao", "organization", "conta"),
        pick("job_title", "jobtitle", "cargo", "funcao", "occupation", "titulo"),
        pick("linkedin_url", "linkedin", "url_do_linkedin", "url", "link", "perfil", "profile", "profile_url", "li_url"),
      ];
    });
  }

  // CSV: primeira linha = cabeçalho
  const delimiter = detectDelimiter(rawText);
  const parsed = parseCSV(rawText, delimiter);
  if (parsed.length < 2) die("CSV sem linhas de dados (só cabeçalho ou vazio).");
  const idx = mapHeaders(parsed[0]);
  if (idx.linkedin_url === undefined) {
    die(
      `Nenhuma coluna de URL do LinkedIn no cabeçalho: ${parsed[0].join(" | ")}\n` +
      "Esperado algo como: LinkedIn URL / linkedin / perfil / url"
    );
  }
  return parsed.slice(1).map((r) => {
    const get = (f) => (idx[f] !== undefined && r[idx[f]] !== undefined ? r[idx[f]] : "");
    return [
      get("full_name"), get("first_name"), get("last_name"),
      get("company"), get("job_title"), get("linkedin_url"),
    ];
  });
}

// ---------- principal ----------

function main() {
  const { input, out } = parseArgs(process.argv);
  if (!input) {
    console.log("Uso: node normalize.mjs <arquivo.csv|arquivo.json> [-o pasta]");
    process.exit(0);
  }
  if (!fs.existsSync(input)) die(`arquivo não encontrado: ${input}`);

  const report = { lidas: 0, validas: 0, dedupe: 0, semUrl: 0, semNome: 0 };
  const rows = loadRows(input);
  report.lidas = rows.length;

  const contacts = [];
  const seenUrls = new Set();
  for (const row of rows) {
    const c = toContact(row, report);
    if (!c) continue;
    if (seenUrls.has(c.linkedin_url)) {
      report.dedupe++;
      continue;
    }
    seenUrls.add(c.linkedin_url);
    contacts.push(c);
    report.validas++;
  }

  if (contacts.length === 0) {
    die(
      `nenhum contato válido em ${input} — ` +
      `${report.semUrl} sem URL do LinkedIn válida, ${report.semNome} sem nome.`
    );
  }

  fs.mkdirSync(out, { recursive: true });
  // stamp + sufixo randômico: duas execuções no mesmo segundo não se sobrescrevem
  const stamp =
    new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) +
    "-" + Math.random().toString(36).slice(2, 6);
  const jsonPath = path.join(out, `contatos-${stamp}.json`);
  const csvPath = path.join(out, `contatos-${stamp}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(contacts, null, 2), "utf8");
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csvHeader = "Full Name,Company,Job Title,LinkedIn URL";
  const csvBody = contacts
    .map((c) => [esc(c.full_name), esc(c.company), esc(c.job_title), esc(c.linkedin_url)].join(","))
    .join("\n");
  fs.writeFileSync(csvPath, `${csvHeader}\n${csvBody}\n`, "utf8");

  console.log(`[normalize] ${input}`);
  console.log(`  lidas:            ${report.lidas}`);
  console.log(`  válidas:          ${report.validas}`);
  console.log(`  duplicatas:       ${report.dedupe} removidas`);
  console.log(`  sem URL LinkedIn: ${report.semUrl} descartadas`);
  console.log(`  sem nome:         ${report.semNome} descartadas`);
  console.log(`  gerados:`);
  console.log(`    ${jsonPath}`);
  console.log(`    ${csvPath}`);
  console.log(`[normalize] Faça o upload de um dos dois arquivos no painel`);
  console.log(`            (Contatos → Importar CSV/JSON, ou dentro de Criar Nova Campanha).`);
}

main();

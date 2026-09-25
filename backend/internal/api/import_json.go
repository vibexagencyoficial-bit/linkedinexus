package api

// Importador JSON tolerante (POST /contacts/import-json): listas reais de
// prospecção chegam com envelopes variados (array no topo, {data: [...]},
// {leads: [...]}) e chaves heterogêneas por origem (perfil_linkedin_url,
// linkedin_decisor, linkedin, nome_decisor, empresa...). O parser aceita
// tudo isso, valida que a URL é realmente de perfil do LinkedIn (descarta
// campos-armadilha como telefone_decisor_linkedin e site_citado_linkedin)
// e canonicaliza a URL para o dedup por (organization_id, linkedin_url)
// funcionar entre arquivos com grafias diferentes da mesma pessoa.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// linkedInProfileRe casa com a URL de perfil em qualquer subdomínio
// (www./br.), com ou sem esquema, inclusive dentro de texto corrido.
// /in/ tem um segmento; /pub/ (legado) tem vários, então aceita barras.
var linkedInProfileRe = regexp.MustCompile(`(?i)linkedin\.com/(?:in/[^\s/?#<>"'\\]+|pub/[^\s?#<>"'\\]+)`)

// canonicalLinkedInURL extrai e normaliza a URL de perfil do LinkedIn contida
// em raw (que pode ser texto corrido). Retorna "" quando não há perfil válido.
// Formas tratadas: percent-encoding (%C3%A9), subdomínio regional (br.),
// query string (?trk=), barra final e ausência de esquema.
func canonicalLinkedInURL(raw string) string {
	m := linkedInProfileRe.FindString(strings.TrimSpace(raw))
	if m == "" {
		return ""
	}
	m = strings.TrimRight(m, ".,;:!?)]}>'\"")
	if dec, err := url.PathUnescape(m); err == nil {
		m = dec
	}
	m = strings.ToLower(strings.TrimSuffix(m, "/"))
	return "https://www." + m
}

// nameFromLinkedInSlug deriva um nome legível do slug do perfil
// ("/in/luciola-coelho-agencia-de-ia" → "Luciola Coelho Agencia De Ia").
// Placeholder quando a lista/manual só traz o link — sem ele {{first_name}}
// trava a cadência com missing_variables.
func nameFromLinkedInSlug(canonical string) string {
	marker := "/in/"
	if i := strings.Index(canonical, "/pub/"); i >= 0 {
		marker = "/pub/"
	}
	i := strings.Index(canonical, marker)
	if i < 0 {
		return ""
	}
	slug := canonical[i+len(marker):]
	if j := strings.IndexByte(slug, '/'); j >= 0 {
		slug = slug[:j]
	}
	parts := strings.Split(slug, "-")
	for k, w := range parts {
		r := []rune(w)
		if len(r) > 0 {
			parts[k] = strings.ToUpper(string(r[0])) + string(r[1:])
		}
	}
	return strings.Join(parts, " ")
}

// envelopeKeys são os nomes de envelope conhecidos; qualquer outra chave com
// valor de array também é aceita (vence a maior).
var envelopeKeys = []string{
	"connections", "contacts", "data", "leads", "prospects", "people",
	"items", "rows", "results", "empresas", "decisores", "lista", "list", "records",
}

// recordsFromParsedJSON achata a raiz do JSON em uma lista de registros:
// array no topo, objeto com envelope (chave conhecida ou o maior array) ou
// objeto único.
func recordsFromParsedJSON(root any) []map[string]any {
	switch v := root.(type) {
	case []any:
		return objectsOnly(v)
	case map[string]any:
		var best []any
		for _, key := range envelopeKeys {
			if arr, ok := v[key].([]any); ok && len(arr) > len(best) {
				best = arr
			}
		}
		if best == nil {
			for _, val := range v {
				if arr, ok := val.([]any); ok && len(arr) > len(best) {
					best = arr
				}
			}
		}
		if best != nil {
			if recs := objectsOnly(best); len(recs) > 0 {
				return recs
			}
		}
		return []map[string]any{v}
	default:
		return nil
	}
}

func objectsOnly(items []any) []map[string]any {
	recs := make([]map[string]any, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			recs = append(recs, m)
		}
	}
	return recs
}

// Aliases pt/en por campo — ordem define precedência. Chaves são normalizadas
// (lowercase, espaço/ponto → "_"), então "LinkedIn URL" casa com linkedin_url.
var (
	nameKeys    = []string{"full_name", "nome_completo", "nome", "nome_decisor", "decisor", "name", "contato", "responsavel"}
	firstKeys   = []string{"first_name", "firstname", "primeiro_nome"}
	lastKeys    = []string{"last_name", "lastname", "sobrenome", "ultimo_nome"}
	companyKeys = []string{"company", "empresa", "empresa_nome", "nome_empresa", "razao_social", "organizacao", "organization", "companhia"}
	jobKeys     = []string{"job_title", "jobtitle", "cargo", "title", "funcao", "posicao", "position", "titulo"}
	// Campos que podem carregar a URL do perfil. A URL só é aceita se casar
	// com o padrão de perfil — "url"/"link" genéricos não pegam site de
	// empresa, e telefone/prosa em campo com "linkedin" no nome não passam.
	linkedinKeys = []string{"linkedin_url", "perfil_linkedin_url", "linkedin_decisor", "url_do_linkedin", "url_linkedin", "linkedin", "profile_url", "profileurl", "url_perfil", "perfil", "url", "link"}
)

func firstNonEmptyString(m map[string]any, keys []string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok {
			if t := strings.TrimSpace(s); t != "" {
				return t
			}
		}
	}
	return ""
}

// normalizeKeys devolve o mapa com chaves normalizadas (lowercase,
// espaço/ponto → "_").
func normalizeKeys(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		nk := strings.ToLower(strings.TrimSpace(k))
		nk = strings.ReplaceAll(nk, " ", "_")
		nk = strings.ReplaceAll(nk, ".", "_")
		out[nk] = v
	}
	return out
}

// findLinkedInDeep varre recursivamente todos os valores string do registro
// (arrays e objetos aninhados incluídos) procurando URL de perfil — pega
// links dentro de prosa (ex.: evidencia_linkedin) que nenhum alias cobre.
func findLinkedInDeep(v any) string {
	switch t := v.(type) {
	case string:
		return canonicalLinkedInURL(t)
	case []any:
		for _, it := range t {
			if u := findLinkedInDeep(it); u != "" {
				return u
			}
		}
	case map[string]any:
		for _, val := range t {
			if u := findLinkedInDeep(val); u != "" {
				return u
			}
		}
	}
	return ""
}

// contactUpsertRow é a linha normalizada pronta para o upsert em contacts.
type contactUpsertRow struct {
	fn, ln, full, comp, job, url string
	meta                         []byte
}

// contactRowFromRecord extrai contato de um registro do JSON. O segundo
// retorno é false quando não há URL de LinkedIn válida (registro é contado
// como skipped, nunca inserido sem link — linkedin_url é NOT NULL e chave
// de dedup).
func contactRowFromRecord(rec map[string]any) (contactUpsertRow, bool) {
	norm := normalizeKeys(rec)
	row := contactUpsertRow{
		fn:   firstNonEmptyString(norm, firstKeys),
		ln:   firstNonEmptyString(norm, lastKeys),
		full: firstNonEmptyString(norm, nameKeys),
		comp: firstNonEmptyString(norm, companyKeys),
		job:  firstNonEmptyString(norm, jobKeys),
	}

	for _, k := range linkedinKeys {
		if s, ok := norm[k].(string); ok {
			if u := canonicalLinkedInURL(s); u != "" {
				row.url = u
				break
			}
		}
	}
	if row.url == "" {
		row.url = findLinkedInDeep(rec)
	}
	if row.url == "" {
		return row, false
	}

	if row.full == "" && row.fn != "" {
		row.full = strings.TrimSpace(row.fn + " " + row.ln)
	}
	if row.fn == "" && row.full != "" {
		row.fn, row.ln = splitFullName(row.full)
	}
	if row.fn == "" && row.full == "" {
		if derived := nameFromLinkedInSlug(row.url); derived != "" {
			row.full = derived
			row.fn, row.ln = splitFullName(derived)
		}
	}

	// Registro original preservado no JSONB: campos que não viraram coluna
	// (score_icp, evidências, emails alternativos...) continuam consultáveis.
	raw, _ := json.Marshal(map[string]any{"origem": "import-json", "registro_original": rec})
	row.meta = raw
	return row, true
}

// insertContactsUpsert persiste em lote na transação com RLS ativa. INSERT
// pipelined (pgx.Batch): COPY FROM não é suportado com RLS (SQLSTATE 0A000).
// Upsert por (organization_id, linkedin_url): reimportar arquivo é
// atualização, não duplicação — inclusive entre arquivos sobrepostos.
func insertContactsUpsert(ctx context.Context, tx pgx.Tx, orgID uuid.UUID, rows []contactUpsertRow) error {
	const chunk = 500
	for start := 0; start < len(rows); start += chunk {
		end := min(start+chunk, len(rows))
		b := &pgx.Batch{}
		for _, row := range rows[start:end] {
			b.Queue(`
				INSERT INTO contacts (organization_id, first_name, last_name, full_name, company, job_title, linkedin_url, metadata)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (organization_id, linkedin_url) DO UPDATE SET
					first_name = EXCLUDED.first_name,
					last_name = EXCLUDED.last_name,
					full_name = EXCLUDED.full_name,
					company = EXCLUDED.company,
					job_title = EXCLUDED.job_title,
					metadata = EXCLUDED.metadata,
					updated_at = NOW()
			`, orgID, row.fn, row.ln, row.full, row.comp, row.job, row.url, row.meta)
		}
		if err := tx.SendBatch(ctx, b).Close(); err != nil {
			return err
		}
	}
	return nil
}

// HandleImportContactsJSON recebe o JSON bruto da lista (array, envelope
// conhecido/desconhecido ou objeto único), extrai e canonicaliza os contatos
// e faz upsert sob o tenant autenticado (RLS mantida via withTenantDB).
func (s *Server) HandleImportContactsJSON(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	if err != nil || len(bytes.TrimSpace(body)) == 0 {
		writeAPIError(w, http.StatusBadRequest, "FILE_REQUIRED", "corpo JSON obrigatório (envie o conteúdo bruto do arquivo)", nil)
		return
	}
	body = bytes.TrimPrefix(body, []byte("\ufeff"))

	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		writeAPIError(w, http.StatusBadRequest, "JSON_PARSE_FAILED", "JSON inválido: "+err.Error(), nil)
		return
	}

	records := recordsFromParsedJSON(root)
	if len(records) == 0 {
		writeAPIError(w, http.StatusBadRequest, "NO_RECORDS", "nenhum registro de contato encontrado no JSON", nil)
		return
	}

	rows := make([]contactUpsertRow, 0, len(records))
	seen := make(map[string]bool, len(records))
	skipped, duplicates := 0, 0
	for _, rec := range records {
		row, ok := contactRowFromRecord(rec)
		if !ok {
			skipped++
			continue
		}
		if seen[row.url] {
			duplicates++
			continue
		}
		seen[row.url] = true
		rows = append(rows, row)
	}

	if len(rows) > 0 {
		if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
			return insertContactsUpsert(r.Context(), tx, orgID, rows)
		}) {
			return // 503 STORE_UNAVAILABLE já respondido pelo helper
		}
		s.broker.Publish(orgID, "contacts.synced", map[string]any{"synced_count": len(rows)})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "completed",
		"imported":   len(rows),
		"skipped":    skipped,
		"duplicates": duplicates,
		"message":    fmt.Sprintf("%d contatos importados, %d duplicados, %d ignorados (sem LinkedIn).", len(rows), duplicates, skipped),
	})
}

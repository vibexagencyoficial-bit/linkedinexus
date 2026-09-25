package api

// Testes do importador JSON tolerante. Os fixtures espelham as estruturas
// reais de dados_prospeccao_vibexcorp: prospects_vibexcorp.json
// (perfil_linkedin_url + percent-encoding), top20_empresas_completas_validadas
// (linkedin_decisor + br.linkedin.com + campos-armadilha) e
// top20_empresas_versao_anterior (linkedin genérico).

import (
	"encoding/json"
	"testing"
)

func TestCanonicalLinkedInURL(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"percent-encoded com barra final", "https://www.linkedin.com/in/paulo-s%C3%A9rgio-nesi-3102214b/", "https://www.linkedin.com/in/paulo-sérgio-nesi-3102214b"},
		{"subdomínio regional br.", "https://br.linkedin.com/in/fulano-beltrano", "https://www.linkedin.com/in/fulano-beltrano"},
		{"sem esquema", "linkedin.com/in/foo-bar", "https://www.linkedin.com/in/foo-bar"},
		{"sem esquema com www e barra", "www.linkedin.com/in/foo-bar/", "https://www.linkedin.com/in/foo-bar"},
		{"query string e maiúsculas", "http://www.linkedin.com/in/Foo-Bar?trk=x", "https://www.linkedin.com/in/foo-bar"},
		{"URL dentro de prosa", "Perfil confirmado em https://www.linkedin.com/in/ana-maria/ em 2024.", "https://www.linkedin.com/in/ana-maria"},
		{"pontuação final de prosa", "veja linkedin.com/in/foo-bar, depois me avise", "https://www.linkedin.com/in/foo-bar"},
		{"pub", "https://www.linkedin.com/pub/john-doe/1/2b/3c4", "https://www.linkedin.com/pub/john-doe/1/2b/3c4"},
		{"telefone não é URL", "+55 11 99999-0000", ""},
		{"site de empresa não é perfil", "https://acme.com.br", ""},
		{"company page não é perfil", "https://www.linkedin.com/company/acme/", ""},
		{"vazio", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canonicalLinkedInURL(tc.in); got != tc.want {
				t.Errorf("canonicalLinkedInURL(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestNameFromLinkedInSlug(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://www.linkedin.com/in/luciola-coelho-agencia-de-ia", "Luciola Coelho Agencia De Ia"},
		{"https://www.linkedin.com/in/ana/", "Ana"},
		{"https://www.linkedin.com/in/ana/", "Ana"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := nameFromLinkedInSlug(tc.in); got != tc.want {
			t.Errorf("nameFromLinkedInSlug(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func assertRow(t *testing.T, row contactUpsertRow, wantURL, wantFull, wantFn, wantLn, wantComp, wantJob string) {
	t.Helper()
	if row.url != wantURL {
		t.Errorf("url = %q, want %q", row.url, wantURL)
	}
	if row.full != wantFull {
		t.Errorf("full_name = %q, want %q", row.full, wantFull)
	}
	if wantFn != "" && row.fn != wantFn {
		t.Errorf("first_name = %q, want %q", row.fn, wantFn)
	}
	if wantLn != "" && row.ln != wantLn {
		t.Errorf("last_name = %q, want %q", row.ln, wantLn)
	}
	if row.comp != wantComp {
		t.Errorf("company = %q, want %q", row.comp, wantComp)
	}
	if row.job != wantJob {
		t.Errorf("job_title = %q, want %q", row.job, wantJob)
	}
	if len(row.meta) == 0 {
		t.Error("metadata vazio — registro original deveria ser preservado")
	}
}

func TestContactRowFromRecordProspectsVibexcorp(t *testing.T) {
	// prospects_vibexcorp.json: perfil_linkedin_url percent-encoded.
	row, ok := contactRowFromRecord(map[string]any{
		"nome":               "Paulo Sérgio Nesi",
		"empresa":            "Usinagem Grafcam do Brasil Ltda",
		"cargo":              "Diretor",
		"perfil_linkedin_url": "https://www.linkedin.com/in/paulo-s%C3%A9rgio-nesi-3102214b/",
	})
	if !ok {
		t.Fatal("registro válido descartado")
	}
	assertRow(t, row,
		"https://www.linkedin.com/in/paulo-sérgio-nesi-3102214b",
		"Paulo Sérgio Nesi", "Paulo", "Sérgio Nesi",
		"Usinagem Grafcam do Brasil Ltda", "Diretor")
}

func TestContactRowFromRecordTop20Validadas(t *testing.T) {
	// top20_empresas_completas_validadas.json: linkedin_decisor com br.
	// subdomain e campos-armadilha que NÃO podem virar URL nem mascarar a real.
	row, ok := contactRowFromRecord(map[string]any{
		"nome_decisor":              "Ana R7 Probe",
		"empresa":                   "ACME Ltda",
		"cargo":                     "Head de Growth",
		"linkedin_decisor":          "https://br.linkedin.com/in/ana-r7-probe",
		"telefone_decisor_linkedin": "+55 11 99999-0000",
		"evidencia_linkedin":        "Perfil validado em https://www.linkedin.com/in/ana-r7-probe/ em 2026.",
		"site_citado_linkedin":      "https://acme.com.br",
	})
	if !ok {
		t.Fatal("registro válido descartado")
	}
	assertRow(t, row,
		"https://www.linkedin.com/in/ana-r7-probe",
		"Ana R7 Probe", "Ana", "R7 Probe",
		"ACME Ltda", "Head de Growth")
}

func TestContactRowFromRecordTop20VersaoAnterior(t *testing.T) {
	// top20_empresas_versao_anterior.json: chave "linkedin" genérica, sem cargo.
	row, ok := contactRowFromRecord(map[string]any{
		"linkedin": "linkedin.com/in/bruno-r7-sino/",
		"nome":     "Bruno R7 Sino",
		"empresa":  "Beta Comercio",
	})
	if !ok {
		t.Fatal("registro válido descartado")
	}
	assertRow(t, row,
		"https://www.linkedin.com/in/bruno-r7-sino",
		"Bruno R7 Sino", "Bruno", "R7 Sino",
		"Beta Comercio", "")
}

func TestContactRowFromRecordSemLinkedIn(t *testing.T) {
	if _, ok := contactRowFromRecord(map[string]any{
		"nome":    "Sem Link",
		"empresa": "X",
	}); ok {
		t.Error("registro sem LinkedIn deveria ser skipped")
	}
	// Campo com "linkedin" no nome mas conteúdo de telefone/prosa/site.
	if _, ok := contactRowFromRecord(map[string]any{
		"nome":                      "Sem Link",
		"telefone_decisor_linkedin": "+55 11 99999-0000",
		"evidencia_linkedin":        "achei o perfil, depois confiro",
		"site_citado_linkedin":      "https://x.com.br",
	}); ok {
		t.Error("armadilhas de campo não deveriam contar como LinkedIn válido")
	}
}

func TestContactRowFromRecordSoComLink(t *testing.T) {
	row, ok := contactRowFromRecord(map[string]any{
		"url": "https://www.linkedin.com/in/luciola-coelho-agencia-de-ia/",
	})
	if !ok {
		t.Fatal("registro só com link deveria ser aceito")
	}
	assertRow(t, row,
		"https://www.linkedin.com/in/luciola-coelho-agencia-de-ia",
		"Luciola Coelho Agencia De Ia", "Luciola", "Coelho Agencia De Ia", "", "")
}

func TestContactRowFromRecordKeysComEspaco(t *testing.T) {
	// Export de planilha: "LinkedIn URL" com espaço e capitalização.
	row, ok := contactRowFromRecord(map[string]any{
		"Full Name":   "Carol Dias",
		"LinkedIn URL": "https://www.linkedin.com/in/carol-dias",
	})
	if !ok {
		t.Fatal("registro com chaves de planilha deveria ser aceito")
	}
	assertRow(t, row,
		"https://www.linkedin.com/in/carol-dias",
		"Carol Dias", "Carol", "Dias", "", "")
}

func mustParse(t *testing.T, s string) any {
	t.Helper()
	var root any
	if err := json.Unmarshal([]byte(s), &root); err != nil {
		t.Fatalf("fixture inválida: %v", err)
	}
	return root
}

func TestRecordsFromParsedJSON(t *testing.T) {
	rec1 := `{"nome":"A","linkedin":"linkedin.com/in/a"}`
	rec2 := `{"nome":"B","linkedin":"linkedin.com/in/b"}`

	cases := []struct {
		name      string
		fixture   string
		wantRecs  int
		wantFirst string
	}{
		{"array no topo", "[" + rec1 + "," + rec2 + "]", 2, "a"},
		{"envelope connections", `{"connections":[` + rec1 + "]}", 1, "a"},
		{"envelope desconhecido data", `{"total":2,"data":[` + rec1 + "," + rec2 + "]}", 2, "a"},
		{"envelope leads", `{"leads":[` + rec1 + "]}", 1, "a"},
		{"maior array vence", `{"metadados":[1,2,3],"decisores":[` + rec1 + "," + rec2 + "]}", 2, "a"},
		{"objeto único", rec1, 1, "a"},
		{"lixo no array é pulado", `[` + rec1 + `,42,"texto",null]`, 1, "a"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recs := recordsFromParsedJSON(mustParse(t, tc.fixture))
			if len(recs) != tc.wantRecs {
				t.Fatalf("records = %d, want %d", len(recs), tc.wantRecs)
			}
			row, ok := contactRowFromRecord(recs[0])
			if !ok || row.url != "https://www.linkedin.com/in/"+tc.wantFirst {
				t.Errorf("primeiro registro errado: ok=%v url=%q", ok, row.url)
			}
		})
	}

	if recs := recordsFromParsedJSON(mustParse(t, `"string solta"`)); recs != nil {
		t.Error("raiz escalar deveria devolver nil")
	}
}

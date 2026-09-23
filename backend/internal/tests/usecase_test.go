package tests

import (
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/api"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/events"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
)

// Testes de USO (R5 do plano de redesign): o caminho que o operador percorre
// na UI, de ponta a ponta, contra handlers HTTP reais e o Postgres local com
// RLS. Fixtures só no banco (org fresca por run); nada hardcoded.
//
// Uso 1 (upload → campanha → entrega): importar CSV na nova campanha →
// selecionar contatos → iniciar → worker enfileira → extensão busca trabalho →
// reporta envio → cadência avança.
//
// Uso 2 (pareamento da extensão, hoje dentro de Configurações): gerar código →
// parear → heartbeat → status CONNECTED visível na UI.
//
// Sem Postgres local, Skip honesto.

func importCSVMultipart(t *testing.T, srv *api.Server, baseReq *http.Request, csvContent string) (int, int) {
	t.Helper()

	var buf strings.Builder
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", "lista-usecase.csv")
	if err != nil {
		t.Fatalf("multipart form file: %v", err)
	}
	if _, err := part.Write([]byte(csvContent)); err != nil {
		t.Fatalf("multipart write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart close: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/v1/contacts/import", strings.NewReader(buf.String())).WithContext(baseReq.Context())
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	srv.HandleImportContactsCSV(rec, req)
	if rec.Code != 200 {
		t.Fatalf("import csv: esperado 200, obtido %d (%s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	inserted, _ := out["inserted"].(float64)
	skipped, _ := out["skipped"].(float64)
	return int(inserted), int(skipped)
}

func fetchContactIDByURL(t *testing.T, c *postgres.Client, orgID uuid.UUID, linkedinURL string) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var id uuid.UUID
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM contacts WHERE organization_id = $1 AND linkedin_url = $2`, orgID, linkedinURL).Scan(&id)
	}); err != nil {
		t.Fatalf("buscar contato importado %s: %v", linkedinURL, err)
	}
	return id
}

func TestUseCase_UploadCSV_Campanha_Entrega(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "usecase-upload", "Usecase Upload CSV")
	_, baseReq := liveToken(t, c, authSvc, orgID)
	seedWorkerUserAndDevice(t, c, orgID)

	// 1. Operador importa a lista (CSV exportado do Sheets/Apollo) na
	// Nova Campanha: full_name sozinho tem que virar first/last, senão a
	// cadência para com missing_variables.
	csvContent := "full_name,company,job_title,linkedin_url\n" +
		"Marina Usecase Silva,UsecaseCorp,Head de Growth,https://linkedin.com/in/usecase-marina\n" +
		"Pedro Usecase,UsecaseCorp,CTO,https://linkedin.com/in/usecase-pedro\n" +
		"Sem URL,UsecaseCorp,Dev,\n"
	inserted, skipped := importCSVMultipart(t, srv, baseReq, csvContent)
	if inserted != 2 || skipped != 1 {
		t.Fatalf("import: esperado inserted=2 skipped=1, obtido inserted=%d skipped=%d", inserted, skipped)
	}

	// Decomposição de nome aconteceu no servidor (sem hardcoded no frontend).
	var firstName, lastName string
	ctxN, cancelN := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelN()
	if err := c.ExecWithTenant(ctxN, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctxN,
			`SELECT first_name, last_name FROM contacts WHERE organization_id = $1 AND linkedin_url = $2`,
			orgID, "https://linkedin.com/in/usecase-marina").Scan(&firstName, &lastName)
	}); err != nil {
		t.Fatalf("contato importado não encontrado: %v", err)
	}
	if firstName != "Marina" || lastName != "Usecase Silva" {
		t.Fatalf("splitFullName falhou: first=%q last=%q", firstName, lastName)
	}

	// 2. Operador marca os contatos na lista e cria a campanha.
	m1 := fetchContactIDByURL(t, c, orgID, "https://linkedin.com/in/usecase-marina")
	m2 := fetchContactIDByURL(t, c, orgID, "https://linkedin.com/in/usecase-pedro")
	campID := createCampaignViaHandler(t, srv, baseReq, []uuid.UUID{m1, m2})
	seedCampaignSteps(t, c, orgID, campID)

	// 3. Inicia a campanha e o worker (device com heartbeat fresco).
	startReq := withChiID(t, httptest.NewRequest("POST", "/api/v1/campaigns/x/start", nil).WithContext(baseReq.Context()), campID.String())
	startRec := httptest.NewRecorder()
	srv.HandleStartCampaign(startRec, startReq)
	if startRec.Code != 200 {
		t.Fatalf("start: esperado 200, obtido %d (%s)", startRec.Code, startRec.Body.String())
	}

	srv.ProcessOutreachStepForOrg(context.Background(), orgID)
	if n := countQueuedJobs(t, c, orgID); n != 1 {
		t.Fatalf("apos o primeiro tick esperado 1 job queued (cooldown de 90s), ha %d", n)
	}

	// 4. Extensão busca o trabalho: render real, sem variável pendente.
	penReq := httptest.NewRequest("GET", "/api/v1/messaging/pending-outreach", nil).WithContext(baseReq.Context())
	penRec := httptest.NewRecorder()
	srv.HandleGetPendingOutreach(penRec, penReq)
	if penRec.Code != 200 {
		t.Fatalf("pending-outreach: esperado 200, obtido %d (%s)", penRec.Code, penRec.Body.String())
	}
	var penOut map[string]any
	_ = json.Unmarshal(penRec.Body.Bytes(), &penOut)
	jobObj, _ := penOut["job"].(map[string]any)
	if jobObj == nil {
		t.Fatalf("pending-outreach sem job: %s", penRec.Body.String())
	}
	rendered, _ := jobObj["rendered_message"].(string)
	if rendered != "Ola Marina, vi voce na UsecaseCorp." {
		t.Fatalf("render inesperado: %q", rendered)
	}
	jobID, _ := jobObj["job_id"].(string)
	if jobID == "" {
		t.Fatalf("job sem job_id: %s", penRec.Body.String())
	}

	// 5. Extensão reporta o envio: job sent, conversa criada, cadência
	// avança para a posição 2 (delay de 1 dia do seed).
	reportBody := `{"job_id":"` + jobID + `"}`
	repReq := httptest.NewRequest("POST", "/api/v1/messaging/report-sent", strings.NewReader(reportBody)).WithContext(baseReq.Context())
	repRec := httptest.NewRecorder()
	srv.HandleReportSentMessage(repRec, repReq)
	if repRec.Code != 200 {
		t.Fatalf("report-sent: esperado 200, obtido %d (%s)", repRec.Code, repRec.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var ccStatus string
	var pos int
	var sentJobs, outboundMsgs int
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT status, current_position FROM campaign_contacts
			WHERE organization_id = $1 AND contact_id = $2
		`, orgID, m1).Scan(&ccStatus, &pos); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM message_jobs WHERE organization_id = $1 AND contact_id = $2 AND status = 'sent'
		`, orgID, m1).Scan(&sentJobs); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM messages m
			JOIN conversations conv ON conv.id = m.conversation_id
			WHERE conv.organization_id = $1 AND conv.contact_id = $2 AND m.direction = 'outbound'
		`, orgID, m1).Scan(&outboundMsgs)
	}); err != nil {
		t.Fatalf("verificar estado pos-entrega: %v", err)
	}
	if ccStatus != "waiting" || pos != 2 {
		t.Fatalf("cadencia deveria estar waiting na posicao 2, obtido %s pos %d", ccStatus, pos)
	}
	if sentJobs != 1 || outboundMsgs != 1 {
		t.Fatalf("entrega nao registrada: sent_jobs=%d outbound_msgs=%d", sentJobs, outboundMsgs)
	}
}

func TestUseCase_Pareamento_Extensao(t *testing.T) {
	c := liveClient(t)
	authSvc := auth.NewService("test-secret", time.Hour)
	srv := api.NewServer(c, authSvc, safety.NewPlatformSafetyService(), events.NewBroker())
	srv.StopOutreachWorker()
	orgID := freshTenantOrg(t, c, "usecase-pair", "Usecase Pareamento Extensao")
	_, baseReq := liveToken(t, c, authSvc, orgID)

	// 1. UI polla status: sem device, OFFLINE honesto (nunca CONNECTED falso).
	statusReq := httptest.NewRequest("GET", "/api/v1/extension/status", nil).WithContext(baseReq.Context())
	statusRec := httptest.NewRecorder()
	srv.HandleExtensionStatus(statusRec, statusReq)
	var statusOut map[string]any
	_ = json.Unmarshal(statusRec.Body.Bytes(), &statusOut)
	if statusOut["status"] != "OFFLINE" || statusOut["connected"] == true {
		t.Fatalf("status inicial: esperado OFFLINE/connected=false, obtido: %s", statusRec.Body.String())
	}

	// 2. Operador clica em "Gerar código de pareamento" na nova seção de
	// Configurações.
	genReq := httptest.NewRequest("POST", "/api/v1/extension/pairing-code", nil).WithContext(baseReq.Context())
	genRec := httptest.NewRecorder()
	srv.HandleGeneratePairingCode(genRec, genReq)
	if genRec.Code != 200 {
		t.Fatalf("pairing-code: esperado 200, obtido %d (%s)", genRec.Code, genRec.Body.String())
	}
	var genOut map[string]any
	_ = json.Unmarshal(genRec.Body.Bytes(), &genOut)
	code, _ := genOut["pairing_code"].(string)
	if code == "" {
		t.Fatalf("pairing-code sem codigo: %s", genRec.Body.String())
	}

	// 3. Extensão consome o código (contrato: campo pairing_code).
	pairReq := httptest.NewRequest("POST", "/api/v1/extension/pair", strReader(`{"pairing_code":"`+code+`","device_name":"Chrome Usecase"}`))
	pairRec := httptest.NewRecorder()
	srv.HandlePairExtension(pairRec, pairReq)
	if pairRec.Code != 200 {
		t.Fatalf("pair: esperado 200, obtido %d (%s)", pairRec.Code, pairRec.Body.String())
	}
	var pairOut map[string]any
	_ = json.Unmarshal(pairRec.Body.Bytes(), &pairOut)
	extToken, _ := pairOut["extension_token"].(string)
	apiJWT, _ := pairOut["api_jwt"].(string)
	if extToken == "" || apiJWT == "" {
		t.Fatalf("pair sem tokens: %s", pairRec.Body.String())
	}
	claims, err := authSvc.ParseToken(apiJWT)
	if err != nil || claims == nil || claims.OrganizationID != orgID {
		t.Fatalf("api_jwt invalido ou de outro tenant: %v", err)
	}

	// 4. Extensão bate heartbeat com o extension_token → UI passa a mostrar
	// CONNECTED.
	hbReq := httptest.NewRequest("POST", "/api/v1/extension/heartbeat", nil)
	hbReq.Header.Set("Authorization", "Bearer "+extToken)
	hbRec := httptest.NewRecorder()
	srv.HandleExtensionHeartbeat(hbRec, hbReq)
	if hbRec.Code != 200 {
		t.Fatalf("heartbeat: esperado 200, obtido %d (%s)", hbRec.Code, hbRec.Body.String())
	}

	statusReq2 := httptest.NewRequest("GET", "/api/v1/extension/status", nil).WithContext(baseReq.Context())
	statusRec2 := httptest.NewRecorder()
	srv.HandleExtensionStatus(statusRec2, statusReq2)
	var statusOut2 map[string]any
	_ = json.Unmarshal(statusRec2.Body.Bytes(), &statusOut2)
	if statusOut2["status"] != "CONNECTED" || statusOut2["connected"] != true {
		t.Fatalf("status final: esperado CONNECTED/connected=true, obtido: %s", statusRec2.Body.String())
	}
}

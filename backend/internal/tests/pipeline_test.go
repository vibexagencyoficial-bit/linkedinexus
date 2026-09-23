package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/api"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
)

// Pipeline real de outreach (PRD-extensao-funcional-100): campanha ativada no
// painel com lista selecionável → worker enfileira job (SÓ com device online,
// janela aberta e render sem variável faltando) → /messaging/pending-outreach
// entrega o trabalho → /messaging/report-sent com job_id confirma a entrega e
// avança a cadência. Falha na entrega → retry (3 tentativas) → cadência
// parada com stop_reason honesto. Nada é marcado "contacted"/"sent" sem
// confirmação real da extensão.
//
// E2E vivo contra o Postgres local (:5433); sem banco, Skip honesto.

func withChiID(t *testing.T, req *http.Request, id string) *http.Request {
	t.Helper()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// seedWorkerUser cria usuário + device ativo com heartbeat agora (worker só
// despacha com extensão viva).
func seedWorkerUserAndDevice(t *testing.T, c *postgres.Client, orgID uuid.UUID) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	userID := uuid.New()
	deviceID := uuid.New()
	email := "worker-e2e-" + orgID.String() + "@vibexcorp.com"
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, organization_id, email, password_hash, name, role)
			VALUES ($1, $2, $3, 'x', 'E2E Worker', 'owner')
			ON CONFLICT (email) DO NOTHING
		`, userID, orgID, email); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO extension_devices (id, organization_id, user_id, device_name, token_hash, status, last_seen_at)
			VALUES ($1, $2, $3, 'Chrome E2E Worker', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'active', NOW())
		`, deviceID, orgID, userID)
		return err
	}); err != nil {
		t.Fatalf("seed user/device: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
			_, _ = tx.Exec(ctx, `DELETE FROM extension_devices WHERE id = $1`, deviceID)
			_, _ = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
			return nil
		})
	})
	return userID, deviceID
}

func seedCampaignSteps(t *testing.T, c *postgres.Client, orgID, campID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO campaign_steps (organization_id, campaign_id, position, step_type, name, template_body, delay_amount, delay_unit)
			VALUES
			  ($1, $2, 1, 'MESSAGE', 'Abertura', 'Ola {{first_name}}, vi voce na {{company}}.', 1, 'days'),
			  ($1, $2, 2, 'MESSAGE', 'Follow-up', 'Retomando, {{full_name}} — fez sentido?', 0, 'days')
		`, orgID, campID)
		return err
	}); err != nil {
		t.Fatalf("seed steps: %v", err)
	}
}

func createCampaignViaHandler(t *testing.T, srv *api.Server, baseReq *http.Request, contactIDs []uuid.UUID) uuid.UUID {
	t.Helper()
	ids := make([]string, 0, len(contactIDs))
	for _, id := range contactIDs {
		ids = append(ids, `"`+id.String()+`"`)
	}
	body := `{"name":"Campanha Pipeline E2E","daily_limit":30,"allowed_start_time":"00:00","allowed_end_time":"23:59","timezone":"America/Sao_Paulo","contact_ids":[` + strings.Join(ids, ",") + `]}`
	req := httptest.NewRequest("POST", "/api/v1/campaigns", strings.NewReader(body)).WithContext(baseReq.Context())
	rec := httptest.NewRecorder()
	srv.HandleCreateCampaign(rec, req)
	if rec.Code != 201 {
		t.Fatalf("create campaign: esperado 201, obtido %d (%s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	raw, _ := out["id"].(string)
	campID, err := uuid.Parse(raw)
	if err != nil {
		t.Fatalf("create campaign sem id: %s", rec.Body.String())
	}
	return campID
}

func countQueuedJobs(t *testing.T, c *postgres.Client, orgID uuid.UUID) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var n int
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT COUNT(*) FROM message_jobs WHERE organization_id = $1 AND status = 'queued'`, orgID).Scan(&n)
	}); err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	return n
}

func countCampaignContactsByStatus(t *testing.T, c *postgres.Client, orgID uuid.UUID, status string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var n int
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT COUNT(*) FROM campaign_contacts WHERE organization_id = $1 AND status = $2`, orgID, status).Scan(&n)
	}); err != nil {
		t.Fatalf("count cc %s: %v", status, err)
	}
	return n
}

func TestPipeline_SemDeviceOnline_NaoEnfileira(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-offline", "Pipeline Offline")
	_, baseReq := liveToken(t, c, authSvc, orgID)

	c1 := seedTenantContact(t, c, orgID, "Contato Sem Device", "https://linkedin.com/in/pipe-sem-device")
	campID := createCampaignViaHandler(t, srv, baseReq, []uuid.UUID{c1})
	seedCampaignSteps(t, c, orgID, campID)

	// start SEM device: campanha running, mas nada é enfileirado.
	startReq := withChiID(t, httptest.NewRequest("POST", "/api/v1/campaigns/x/start", nil).WithContext(baseReq.Context()), campID.String())
	startRec := httptest.NewRecorder()
	srv.HandleStartCampaign(startRec, startReq)
	if startRec.Code != 200 {
		t.Fatalf("start: esperado 200, obtido %d (%s)", startRec.Code, startRec.Body.String())
	}

	srv.ProcessOutreachStepForOrg(context.Background(), orgID)

	if n := countQueuedJobs(t, c, orgID); n != 0 {
		t.Fatalf("sem device online o worker NAO deveria enfileirar; enfileirou %d", n)
	}
	if n := countCampaignContactsByStatus(t, c, orgID, "contacted"); n != 0 {
		t.Fatalf("sem device online nenhum contato viraria 'contacted'; viraram %d", n)
	}
}

func TestPipeline_FluxoCompleto_Job_Entrega_Avanco(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-full", "Pipeline Full")
	_, baseReq := liveToken(t, c, authSvc, orgID)
	seedWorkerUserAndDevice(t, c, orgID)

	// Lista selecionável: 2 contatos marcados; um terceiro NÃO selecionado
	// não pode entrar na cadência.
	c1 := seedTenantContact(t, c, orgID, "Ana Pipeline", "https://linkedin.com/in/pipe-ana")
	c2 := seedTenantContact(t, c, orgID, "Bruno Pipeline", "https://linkedin.com/in/pipe-bruno")
	c3 := seedTenantContact(t, c, orgID, "Fora DaLista", "https://linkedin.com/in/pipe-fora")
	campID := createCampaignViaHandler(t, srv, baseReq, []uuid.UUID{c1, c2})
	seedCampaignSteps(t, c, orgID, campID)

	// Lista respeitada: Fora DaLista NÃO entrou na cadência.
	ctxChk, cancelChk := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelChk()
	var foraStage int
	if err := c.ExecWithTenant(ctxChk, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctxChk, `SELECT COUNT(*) FROM campaign_contacts WHERE organization_id = $1 AND contact_id = $2`, orgID, c3).Scan(&foraStage)
	}); err != nil {
		t.Fatalf("check c3: %v", err)
	}
	if foraStage != 0 {
		t.Fatalf("contato fora da lista entrou na cadencia (%d)", foraStage)
	}

	// start: não repopula com TODOS (a lista já foi escolhida na criação).
	startReq := withChiID(t, httptest.NewRequest("POST", "/api/v1/campaigns/x/start", nil).WithContext(baseReq.Context()), campID.String())
	startRec := httptest.NewRecorder()
	srv.HandleStartCampaign(startRec, startReq)
	if startRec.Code != 200 {
		t.Fatalf("start: esperado 200, obtido %d (%s)", startRec.Code, startRec.Body.String())
	}

	// 1. Worker com device online: enfileira o PRIMEIRO contato (Ana), sem
	// marcar contacted, sem inventar message.sent.
	srv.ProcessOutreachStepForOrg(context.Background(), orgID)
	if n := countQueuedJobs(t, c, orgID); n != 1 {
		t.Fatalf("apos 1 tick esperado 1 job queued, ha %d", n)
	}
	if n := countCampaignContactsByStatus(t, c, orgID, "contacted"); n != 0 {
		t.Fatalf("worker honesto nao marca contacted antes da entrega; marcou %d", n)
	}

	// 2. pending-outreach devolve o job REAL (renderizado, sem {{}}).
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
	if strings.Contains(rendered, "{{") {
		t.Fatalf("mensagem com variavel nao resolvida saiu para a extensao: %q", rendered)
	}
	// seedTenantContact fixa first_name='Cross' e company='Acme'.
	if rendered != "Ola Cross, vi voce na Acme." {
		t.Fatalf("render inesperado: %q", rendered)
	}
	jobID, _ := jobObj["job_id"].(string)
	if jobID == "" {
		t.Fatalf("job sem job_id: %s", penRec.Body.String())
	}

	// 3. report-sent com job_id: confirma entrega, cria conversa + mensagem
	// outbound, marca contacted e AVANÇA a cadência (posição 2, delay 1 dia).
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
	var nextExec *time.Time
	var pos int
	var convID uuid.UUID
	var msgCount, sentJobs int
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT cc.status, cc.next_execution_at, cc.current_position
			FROM campaign_contacts cc WHERE cc.organization_id = $1 AND cc.contact_id = $2
		`, orgID, c1).Scan(&ccStatus, &nextExec, &pos); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM messages m
			JOIN conversations conv ON conv.id = m.conversation_id
			WHERE conv.organization_id = $1 AND conv.contact_id = $2 AND m.direction = 'outbound'
		`, orgID, c1).Scan(&msgCount); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM message_jobs WHERE organization_id = $1 AND contact_id = $2 AND status = 'sent'
		`, orgID, c1).Scan(&sentJobs); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			SELECT id FROM conversations WHERE organization_id = $1 AND contact_id = $2
		`, orgID, c1).Scan(&convID)
	}); err != nil {
		t.Fatalf("pos-report: %v", err)
	}
	if ccStatus != "waiting" || pos != 2 {
		t.Fatalf("cadencia deveria ter avançado p/ posicao 2 waiting; obtido %s pos %d", ccStatus, pos)
	}
	if nextExec == nil || !nextExec.After(time.Now()) {
		t.Fatalf("next_execution_at deveria ser futuro (delay 1 dia do passo 1); obtido %v", nextExec)
	}
	if msgCount != 1 || sentJobs != 1 || convID == uuid.Nil {
		t.Fatalf("entrega real: esperado 1 outbound, 1 job sent, conversa criada; obtido msgs=%d sent=%d conv=%s", msgCount, sentJobs, convID)
	}

	// 4. Segundo tick: Bruno (hora chegada) — Ana está com delay futuro.
	srv.ProcessOutreachStepForOrg(context.Background(), orgID)
	if n := countQueuedJobs(t, c, orgID); n != 1 {
		t.Fatalf("apos tick 2 esperado 1 job queued (Bruno), ha %d", n)
	}
	if n := countCampaignContactsByStatus(t, c, orgID, "stopped"); n != 0 {
		t.Fatalf("contato Fora DaLista nao deveria estar na cadencia; stopped=%d", n)
	}
}

func TestPipeline_ReportErro_Retry3_Para(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-err", "Pipeline Erro")
	_, baseReq := liveToken(t, c, authSvc, orgID)
	seedWorkerUserAndDevice(t, c, orgID)

	c1 := seedTenantContact(t, c, orgID, "Cleyde Erro", "https://linkedin.com/in/pipe-erro")
	campID := createCampaignViaHandler(t, srv, baseReq, []uuid.UUID{c1})
	seedCampaignSteps(t, c, orgID, campID)

	startReq := withChiID(t, httptest.NewRequest("POST", "/api/v1/campaigns/x/start", nil).WithContext(baseReq.Context()), campID.String())
	startRec := httptest.NewRecorder()
	srv.HandleStartCampaign(startRec, startReq)
	if startRec.Code != 200 {
		t.Fatalf("start: %d (%s)", startRec.Code, startRec.Body.String())
	}

	srv.ProcessOutreachStepForOrg(context.Background(), orgID)
	penReq := httptest.NewRequest("GET", "/api/v1/messaging/pending-outreach", nil).WithContext(baseReq.Context())
	penRec := httptest.NewRecorder()
	srv.HandleGetPendingOutreach(penRec, penReq)
	var penOut map[string]any
	_ = json.Unmarshal(penRec.Body.Bytes(), &penOut)
	jobObj, _ := penOut["job"].(map[string]any)
	if jobObj == nil {
		t.Fatalf("sem job para o teste de erro: %s", penRec.Body.String())
	}
	jobID, _ := jobObj["job_id"].(string)

	// 2 falhas: job segue queued (retry).
	for i := 0; i < 2; i++ {
		repReq := httptest.NewRequest("POST", "/api/v1/messaging/report-sent", strings.NewReader(`{"job_id":"`+jobID+`","error":"seletor nao encontrado"}`)).WithContext(baseReq.Context())
		rec := httptest.NewRecorder()
		srv.HandleReportSentMessage(rec, repReq)
		if rec.Code != 200 {
			t.Fatalf("report erro %d: %d (%s)", i, rec.Code, rec.Body.String())
		}
	}
	if n := countQueuedJobs(t, c, orgID); n != 1 {
		t.Fatalf("apos 2 erros o job deveria seguir queued p/ retry; queued=%d", n)
	}

	// 3ª falha: falha definitiva + cadência parada com stop_reason honesto.
	repReq3 := httptest.NewRequest("POST", "/api/v1/messaging/report-sent", strings.NewReader(`{"job_id":"`+jobID+`","error":"linkedin bloqueou"}`)).WithContext(baseReq.Context())
	rec3 := httptest.NewRecorder()
	srv.HandleReportSentMessage(rec3, repReq3)
	if rec3.Code != 200 {
		t.Fatalf("report erro 3: %d (%s)", rec3.Code, rec3.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var status, stopReason string
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT cc.status, COALESCE(cc.stop_reason, '')
			FROM campaign_contacts cc WHERE cc.organization_id = $1 AND cc.contact_id = $2
		`, orgID, c1).Scan(&status, &stopReason)
	}); err != nil {
		t.Fatalf("pos-3erros: %v", err)
	}
	if status != "stopped" || stopReason != "delivery_failed" {
		t.Fatalf("apos 3 erros: esperado stopped/delivery_failed, obtido %s/%s", status, stopReason)
	}
}

func TestDailyLimits_GetPut_Persiste(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-limits", "Pipeline Limits")
	_, baseReq := liveToken(t, c, authSvc, orgID)

	putReq := httptest.NewRequest("PUT", "/api/v1/settings/daily-limits", strings.NewReader(`{"daily_limit":42,"allowed_start_time":"09:30","allowed_end_time":"17:00","timezone":"America/Sao_Paulo"}`)).WithContext(baseReq.Context())
	putRec := httptest.NewRecorder()
	srv.HandleSaveDailyLimits(putRec, putReq)
	if putRec.Code != 200 {
		t.Fatalf("put daily-limits: %d (%s)", putRec.Code, putRec.Body.String())
	}

	getReq := httptest.NewRequest("GET", "/api/v1/settings/daily-limits", nil).WithContext(baseReq.Context())
	getRec := httptest.NewRecorder()
	srv.HandleGetDailyLimits(getRec, getReq)
	var out map[string]any
	_ = json.Unmarshal(getRec.Body.Bytes(), &out)
	if out["daily_limit"] != float64(42) || out["allowed_start_time"] != "09:30" || out["allowed_end_time"] != "17:00" {
		t.Fatalf("limites nao persistiram: %s", getRec.Body.String())
	}
	if out["server_max_limit"] != float64(50) {
		t.Fatalf("teto do servidor ausente: %s", getRec.Body.String())
	}
}

func TestAssist_SemChave_FallbackHonesto(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-assist", "Pipeline Assist")
	_, baseReq := liveToken(t, c, authSvc, orgID)

	req := httptest.NewRequest("POST", "/api/v1/assist/humanize", strings.NewReader(`{"action":"send_message","selectors":["button.msg-form__send-button"],"page_fingerprint":"/messaging/thread"}`)).WithContext(baseReq.Context())
	rec := httptest.NewRecorder()
	srv.HandleAssistHumanize(rec, req)
	if rec.Code != 200 {
		t.Fatalf("assist: %d (%s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["assist_available"] != false || out["source"] != "fallback" {
		t.Fatalf("sem chave configurada o assist deve responder fallback honesto: %s", rec.Body.String())
	}
	if v, ok := out["click_delay_ms"].(float64); !ok || v <= 0 {
		t.Fatalf("fallback sem curva de timing: %s", rec.Body.String())
	}
}

// Regressão do pânico 500-vazio (fila vazia): org sem campanhas e sem jobs →
// pending-outreach responde 200 honesto com has_campaign=false, nunca deref
// de ponteiro nil em job.queueRemaining.
func TestPendingOutreach_FilaVazia_200Honesto(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-empty", "Pipeline Fila Vazia")
	token, baseReq := liveToken(t, c, authSvc, orgID)

	req := httptest.NewRequest("GET", "/api/v1/messaging/pending-outreach", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req = withChiID(t, req.WithContext(baseReq.Context()), orgID.String())
	rec := httptest.NewRecorder()
	srv.HandleGetPendingOutreach(rec, req)

	if rec.Code != 200 {
		t.Fatalf("fila vazia: esperado 200, obtido %d (%s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("resposta não é JSON: %v", err)
	}
	if out["has_campaign"] != false {
		t.Fatalf("esperado has_campaign=false, obtido %v", out["has_campaign"])
	}
	if out["job"] != nil {
		t.Fatalf("esperado job=null, obtido %v", out["job"])
	}
}

// Regressão: cadência VAZIA (campanha criada sem fluxo — "Fluxo em Branco" ou
// via API) não pode completar contatos. Antes da correção, o worker via
// ErrNoRows na posição 1 e marcava 'completed' — contato encerrado sem nunca
// ter recebido nada, silenciosamente.
func TestPipeline_CadenciaVazia_NaoCompletaContatos(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pipe-vazia", "Pipeline Cadencia Vazia")
	_, baseReq := liveToken(t, c, authSvc, orgID)
	seedWorkerUserAndDevice(t, c, orgID)

	c1 := seedTenantContact(t, c, orgID, "Sem Steps", "https://linkedin.com/in/pipe-sem-steps")
	campID := createCampaignViaHandler(t, srv, baseReq, []uuid.UUID{c1})
	// SEM seedCampaignSteps: cadência propositalmente vazia.

	startReq := withChiID(t, httptest.NewRequest("POST", "/api/v1/campaigns/x/start", nil).WithContext(baseReq.Context()), campID.String())
	startRec := httptest.NewRecorder()
	srv.HandleStartCampaign(startRec, startReq)
	if startRec.Code != 200 {
		t.Fatalf("start: esperado 200, obtido %d (%s)", startRec.Code, startRec.Body.String())
	}

	srv.ProcessOutreachStepForOrg(context.Background(), orgID)

	if n := countCampaignContactsByStatus(t, c, orgID, "completed"); n != 0 {
		t.Fatalf("cadencia vazia completou %d contato(s) sem enviar nada — devia ficar pendente", n)
	}
	if n := countCampaignContactsByStatus(t, c, orgID, "pending"); n != 1 {
		t.Fatalf("contato devia permanecer 'pending' ate haver cadencia; pending=%d", n)
	}

	// E depois de a cadência existir, o tick seguinte enfileira normalmente.
	seedCampaignSteps(t, c, orgID, campID)
	srv.ProcessOutreachStepForOrg(context.Background(), orgID)
	if n := countQueuedJobs(t, c, orgID); n != 1 {
		t.Fatalf("apos adicionar steps o worker devia enfileirar 1 job; ha %d", n)
	}
}

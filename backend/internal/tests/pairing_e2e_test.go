package tests

import (
	"context"
	"encoding/json"
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

// Contrato de pareamento real (PRD-honestidade-conexao, Fase C), E2E vivo
// contra o Postgres local (porta 5433):
// - pairing-code gerado via handler autenticado usa 10min de validade;
// - pair com código expirado/consumido/inexistente → 404 INVALID_PAIRING_CODE;
// - extension/status sem device ativo → OFFLINE (200 honesto, nunca CONNECTED);
// - heartbeat com token falso → 401; com token real → 200 + status CONNECTED;
// - POST /accounts/connect sem evidência (sem device recente, sem
//   session_key) → 428 EVIDENCE_REQUIRED; com session_key → 200 connected.
//
// Sem Postgres local, tudo é Skip honesto (nunca finge o E2E).

func strReader(s string) *strings.Reader { return strings.NewReader(s) }

func liveClient(t *testing.T) *postgres.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, err := postgres.New(ctx, crossTenantDBURL)
	if err != nil {
		t.Skipf("postgres local indisponivel (rode scripts/local/start.ps1): %v", err)
	}
	t.Cleanup(c.Close)
	return c
}

func liveServer(c *postgres.Client) (*api.Server, *auth.Service) {
	authSvc := auth.NewService("test-secret", time.Hour)
	srv := api.NewServer(c, authSvc, safety.NewPlatformSafetyService(), events.NewBroker())
	// Testes controlam os ticks explicitamente: worker vivo de um servidor de
	// outro teste não pode processar a org de um teste em andamento.
	srv.StopOutreachWorker()
	return srv, authSvc
}

func liveToken(t *testing.T, c *postgres.Client, authSvc *auth.Service, orgID uuid.UUID) (string, *http.Request) {
	t.Helper()
	// O usuário de prova existe de verdade: extension_devices e
	// linkedin_accounts têm FK para users(id), e o RLS de users exige o
	// contexto do tenant no INSERT.
	userID := uuid.New()
	email := "e2e-c-" + orgID.String() + "@vibexcorp.com"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		// Reaproveita o usuário da org se já existir ( reruns do teste usam
		// o mesmo e-mail estável): ON CONFLICT não retorna o id, então lê
		// de volta para o token carregar um user_id com FK válida.
		_, _ = tx.Exec(ctx, `
			INSERT INTO users (id, organization_id, email, password_hash, name, role)
			VALUES ($1, $2, $3, 'x', 'E2E', 'owner')
			ON CONFLICT (email) DO NOTHING
		`, userID, orgID, email)
		return tx.QueryRow(ctx, `
			SELECT id FROM users WHERE organization_id = $1 AND email = $2
		`, orgID, email).Scan(&userID)
	}); err != nil {
		t.Fatalf("seed user e2e: %v", err)
	}
	token, err := authSvc.GenerateToken(userID, orgID, "e2e@vibexcorp.com", "owner")
	if err != nil {
		t.Fatalf("gerar token: %v", err)
	}
	req := httptest.NewRequest("POST", "/x", nil)
	return token, withTestClaims(req, token)
}

func TestPairing_Expirado_Consumido_Inexistente_404(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID := freshTenantOrg(t, c, "pair-e2e-c", "Pair E2E (C)")
	token, baseReq := liveToken(t, c, authSvc, orgID)

	// 1. Gera um código real via handler.
	genReq := httptest.NewRequest("POST", "/api/v1/extension/pairing-code", nil).WithContext(baseReq.Context())
	genRec := httptest.NewRecorder()
	srv.HandleGeneratePairingCode(genRec, genReq)
	if genRec.Code != 200 {
		t.Fatalf("generate pairing-code: esperado 200, obtido %d (%s)", genRec.Code, genRec.Body.String())
	}
	var genOut map[string]any
	_ = json.Unmarshal(genRec.Body.Bytes(), &genOut)
	code, _ := genOut["pairing_code"].(string)
	if code == "" {
		t.Fatalf("generate sem pairing_code: %s", genRec.Body.String())
	}

	// 2. Expira o código direto no banco (simula os 10min estourados).
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE extension_devices SET pairing_expires_at = NOW() - INTERVAL '1 minute' WHERE pairing_code = $1`, code)
		return err
	}); err != nil {
		t.Fatalf("expirar codigo: %v", err)
	}

	// 3. Pair com código expirado → 404 INVALID_PAIRING_CODE.
	pairBody := `{"pairing_code":"` + code + `","device_name":"Chrome E2E"}`
	pairReq := httptest.NewRequest("POST", "/api/v1/extension/pair", strReader(pairBody))
	pairRec := httptest.NewRecorder()
	srv.HandlePairExtension(pairRec, pairReq)
	assertPairing404(t, pairRec, "expirado")

	// 4. Pair com código inexistente → 404 INVALID_PAIRING_CODE.
	pairReq2 := httptest.NewRequest("POST", "/api/v1/extension/pair", strReader(`{"pairing_code":"ZZZZNUNCAEXISTE","device_name":"Chrome E2E"}`))
	pairRec2 := httptest.NewRecorder()
	srv.HandlePairExtension(pairRec2, pairReq2)
	assertPairing404(t, pairRec2, "inexistente")

	_ = token
}

func assertPairing404(t *testing.T, rec *httptest.ResponseRecorder, caso string) {
	t.Helper()
	if rec.Code != 404 {
		t.Fatalf("pair %s: esperado 404, obtido %d (%s)", caso, rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	errObj, ok := out["error"].(map[string]any)
	if !ok || errObj["code"] != "INVALID_PAIRING_CODE" {
		t.Fatalf("pair %s: esperado code INVALID_PAIRING_CODE, obtido: %s", caso, rec.Body.String())
	}
	if _, has := out["extension_token"]; has {
		t.Fatalf("pair %s fabricou extension_token: %s", caso, rec.Body.String())
	}
}

func TestPairing_FluxoFeliz_Status_Heartbeat_Connect(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	// Org fresca por run (sufixo temporal): garante "sem device" real no passo
	// 1 mesmo com reruns — devices de runs anteriores pertencem a outra org.
	orgID := freshTenantOrg(t, c, "pair-e2e-happy", "Pair Happy (C)")
	_, baseReq := liveToken(t, c, authSvc, orgID)

	// 1. Status antes de qualquer device → OFFLINE honesto.
	statusReq := httptest.NewRequest("GET", "/api/v1/extension/status", nil).WithContext(baseReq.Context())
	statusRec := httptest.NewRecorder()
	srv.HandleExtensionStatus(statusRec, statusReq)
	var statusOut map[string]any
	_ = json.Unmarshal(statusRec.Body.Bytes(), &statusOut)
	if statusOut["status"] != "OFFLINE" || statusOut["connected"] == true {
		t.Fatalf("sem device: esperado OFFLINE/connected=false, obtido: %s", statusRec.Body.String())
	}

	// 2. Connect sem evidência (sem device, sem session_key) → 428.
	connectReq := httptest.NewRequest("POST", "/api/v1/accounts/connect", strReader(`{"display_name":"Perfil E2E"}`)).WithContext(baseReq.Context())
	connectRec := httptest.NewRecorder()
	srv.HandleConnectAccount(connectRec, connectReq)
	if connectRec.Code != 428 {
		t.Fatalf("connect sem evidencia: esperado 428, obtido %d (%s)", connectRec.Code, connectRec.Body.String())
	}
	var connectOut map[string]any
	_ = json.Unmarshal(connectRec.Body.Bytes(), &connectOut)
	if errObj, ok := connectOut["error"].(map[string]any); !ok || errObj["code"] != "EVIDENCE_REQUIRED" {
		t.Fatalf("connect sem evidencia: esperado code EVIDENCE_REQUIRED, obtido: %s", connectRec.Body.String())
	}

	// 3. Connect COM session_key → 200 connected.
	connectReq2 := httptest.NewRequest("POST", "/api/v1/accounts/connect", strReader(`{"display_name":"Perfil E2E","session_key":"sessao-verificavel-e2e"}`)).WithContext(baseReq.Context())
	connectRec2 := httptest.NewRecorder()
	srv.HandleConnectAccount(connectRec2, connectReq2)
	if connectRec2.Code != 200 {
		t.Fatalf("connect com session_key: esperado 200, obtido %d (%s)", connectRec2.Code, connectRec2.Body.String())
	}

	// 4. Pair real: gera código e consome via handler (token verdadeiro).
	genReq := httptest.NewRequest("POST", "/api/v1/extension/pairing-code", nil).WithContext(baseReq.Context())
	genRec := httptest.NewRecorder()
	srv.HandleGeneratePairingCode(genRec, genReq)
	var genOut map[string]any
	_ = json.Unmarshal(genRec.Body.Bytes(), &genOut)
	code, _ := genOut["pairing_code"].(string)
	if code == "" {
		t.Fatalf("generate sem pairing_code: %s", genRec.Body.String())
	}
	pairReq := httptest.NewRequest("POST", "/api/v1/extension/pair", strReader(`{"pairing_code":"`+code+`"}`))
	pairRec := httptest.NewRecorder()
	srv.HandlePairExtension(pairRec, pairReq)
	if pairRec.Code != 200 {
		t.Fatalf("pair real: esperado 200, obtido %d (%s)", pairRec.Code, pairRec.Body.String())
	}
	var pairOut map[string]any
	_ = json.Unmarshal(pairRec.Body.Bytes(), &pairOut)
	rawToken, _ := pairOut["extension_token"].(string)
	if rawToken == "" {
		t.Fatalf("pair real sem extension_token: %s", pairRec.Body.String())
	}
	// Pipeline real: pair também devolve JWT assinado para a extensão
	// consumir /messaging/* e /assist/*.
	apiJWT, _ := pairOut["api_jwt"].(string)
	if apiJWT == "" {
		t.Fatalf("pair real sem api_jwt: %s", pairRec.Body.String())
	}
	claims, err := authSvc.ParseToken(apiJWT)
	if err != nil || claims == nil || claims.OrganizationID != orgID {
		t.Fatalf("api_jwt inválido ou de outro tenant: %v", err)
	}

	// 5. Reuso do mesmo código (já consumido) → 404.
	pairReqReuse := httptest.NewRequest("POST", "/api/v1/extension/pair", strReader(`{"pairing_code":"`+code+`"}`))
	pairRecReuse := httptest.NewRecorder()
	srv.HandlePairExtension(pairRecReuse, pairReqReuse)
	assertPairing404(t, pairRecReuse, "consumido")

	// 6. Heartbeat com token falso → 401.
	hbFake := httptest.NewRequest("POST", "/api/v1/extension/heartbeat", nil)
	hbFake.Header.Set("Authorization", "Bearer "+"f"+"000000000000000000000000000000000000000000000000000000000000000")
	hbFakeRec := httptest.NewRecorder()
	srv.HandleExtensionHeartbeat(hbFakeRec, hbFake)
	if hbFakeRec.Code != 401 {
		t.Fatalf("heartbeat falso: esperado 401, obtido %d (%s)", hbFakeRec.Code, hbFakeRec.Body.String())
	}

	// 7. Heartbeat com token real → 200.
	hb := httptest.NewRequest("POST", "/api/v1/extension/heartbeat", nil)
	hb.Header.Set("Authorization", "Bearer "+rawToken)
	hbRec := httptest.NewRecorder()
	srv.HandleExtensionHeartbeat(hbRec, hb)
	if hbRec.Code != 200 {
		t.Fatalf("heartbeat real: esperado 200, obtido %d (%s)", hbRec.Code, hbRec.Body.String())
	}

	// 8. Status agora → CONNECTED.
	statusReq2 := httptest.NewRequest("GET", "/api/v1/extension/status", nil).WithContext(baseReq.Context())
	statusRec2 := httptest.NewRecorder()
	srv.HandleExtensionStatus(statusRec2, statusReq2)
	var statusOut2 map[string]any
	_ = json.Unmarshal(statusRec2.Body.Bytes(), &statusOut2)
	if statusOut2["status"] != "CONNECTED" || statusOut2["connected"] != true {
		t.Fatalf("apos heartbeat: esperado CONNECTED/connected=true, obtido: %s", statusRec2.Body.String())
	}
}

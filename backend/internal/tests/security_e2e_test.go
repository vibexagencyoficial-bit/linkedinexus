package tests

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/api"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/events"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	redisplatform "github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
)

// E2E de segurança (Fase F7) contra o Postgres local (porta 5433):
//   - JWT assinado SEM sessão viva no banco → 401 (validator DB-backed);
//   - sessão revogada → 401 imediato, mesmo com JWT ainda válido;
//   - /auth/refresh roda SEM Authorization (público) e rotaciona o refresh:
//     reuso do refresh antigo → 401 (uso único);
//   - POST /extension/token renova o api_jwt pelo extension_token do device;
//   - CORS: allowlist estrita (localhost:3001/3000 + chrome-extension://);
//     origem estranha não recebe Access-Control-Allow-Origin;
//   - rate limit login 10/min/IP → 429 RATE_LIMITED (precisa do Redis local).
//
// Sem Postgres/Redis locais, os testes dependentes dão Skip honesto.

func sha256Hex(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randHex(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return hex.EncodeToString(b)
}

// secRouter sobe o router completo (middleware + CORS + rate limit) em um
// httptest.Server. redisClient nil → limites em fail-open (comportamento real
// de produção sem Redis).
func secRouter(t *testing.T, srv *api.Server) *httptest.Server {
	t.Helper()
	ts := httptest.NewServer(srv.SetupRouter())
	t.Cleanup(ts.Close)
	return ts
}

// secSeed cria org + user e devolve (orgID, userID, email).
func secSeed(t *testing.T, c *postgres.Client, slug, name string) (uuid.UUID, uuid.UUID, string) {
	t.Helper()
	orgID := freshTenantOrg(t, c, slug, name)
	userID := uuid.New()
	email := slug + "-" + orgID.String() + "@vibexcorp.com"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO users (id, organization_id, email, password_hash, name, role)
			VALUES ($1, $2, $3, 'x', 'SecE2E', 'owner')
			ON CONFLICT (email) DO NOTHING
		`, userID, orgID, email)
		return err
	}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return orgID, userID, email
}

// secInsertSession insere uma sessão por hash (mesmo contrato de
// insertAuthSession em handlers_sessions.go).
func secInsertSession(t *testing.T, c *postgres.Client, orgID, userID uuid.UUID, sessionID *uuid.UUID, kind, rawToken string, ttl time.Duration) {
	t.Helper()
	sid := uuid.New()
	if sessionID != nil {
		sid = *sessionID
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO auth_sessions (id, organization_id, user_id, token_hash, kind, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, sid, orgID, userID, sha256Hex(rawToken), kind, time.Now().Add(ttl))
		return err
	}); err != nil {
		t.Fatalf("insert auth_session %s: %v", kind, err)
	}
}

func secGet(t *testing.T, url, path, bearer string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("GET", url+path, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func secPost(t *testing.T, url, path, bearer, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("POST", url+path, strReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// TestSessionValidator_JWTValidoExigeSessaoViva: o JWT assinado não basta —
// o middleware consulta auth_sessions pelo sid a cada request.
func TestSessionValidator_JWTValidoExigeSessaoViva(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID, userID, email := secSeed(t, c, "sec-sess", "Sec E2E Sessao")

	sid := uuid.New()
	token, err := authSvc.GenerateTokenWithTTL(userID, orgID, email, "owner", time.Hour, sid.String())
	if err != nil {
		t.Fatalf("gerar token: %v", err)
	}
	ts := secRouter(t, srv)

	// 1. JWT assinado, SEM sessão no banco → 401.
	if resp := secGet(t, ts.URL, "/api/v1/auth/me", token); resp.StatusCode != 401 {
		t.Fatalf("sem sessão: esperado 401, obtido %d", resp.StatusCode)
	}

	// 2. Sessão viva inserida (mesmo sid) → 200.
	secInsertSession(t, c, orgID, userID, &sid, "panel", token, time.Hour)
	if resp := secGet(t, ts.URL, "/api/v1/auth/me", token); resp.StatusCode != 200 {
		t.Fatalf("com sessão viva: esperado 200, obtido %d", resp.StatusCode)
	}

	// 3. Sessão revogada (logout/comprometimento) → 401 imediato com o JWT
	// ainda dentro da validade.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`, sid)
		return err
	}); err != nil {
		t.Fatalf("revogar sessão: %v", err)
	}
	if resp := secGet(t, ts.URL, "/api/v1/auth/me", token); resp.StatusCode != 401 {
		t.Fatalf("sessão revogada: esperado 401, obtido %d", resp.StatusCode)
	}
}

// TestRefreshDB_RotacaoPublica_UsoUnico: refresh sem Authorization (o access
// acabou de expirar — é o único cenário real de uso) e rotação de uso único.
func TestRefreshDB_RotacaoPublica_UsoUnico(t *testing.T) {
	c := liveClient(t)
	srv, _ := liveServer(c)
	orgID, userID, _ := secSeed(t, c, "sec-refr", "Sec E2E Refresh")
	ts := secRouter(t, srv)

	refresh := randHex(t)
	secInsertSession(t, c, orgID, userID, nil, "refresh", refresh, 7*24*time.Hour)

	// 1. SEM header Authorization (access expirado) → 200 com novo par.
	resp := secPost(t, ts.URL, "/api/v1/auth/refresh", "", `{"refresh_token":"`+refresh+`"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("refresh: esperado 200, obtido %d", resp.StatusCode)
	}
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	newAccess, _ := out["token"].(string)
	newRefresh, _ := out["refresh_token"].(string)
	if newAccess == "" || newRefresh == "" || newRefresh == refresh {
		t.Fatalf("refresh sem par novo ou sem rotação: %s", out)
	}

	// 2. O access emitido tem sessão viva → /auth/me 200.
	if resp := secGet(t, ts.URL, "/api/v1/auth/me", newAccess); resp.StatusCode != 200 {
		t.Fatalf("access pós-refresh: esperado 200, obtido %d", resp.StatusCode)
	}

	// 3. Reuso do refresh JÁ rotacionado → 401 (uso único; replay detectado).
	resp2 := secPost(t, ts.URL, "/api/v1/auth/refresh", "", `{"refresh_token":"`+refresh+`"}`)
	if resp2.StatusCode != 401 {
		t.Fatalf("refresh reusado: esperado 401, obtido %d", resp2.StatusCode)
	}

	// 4. refresh_token fabricado → 401.
	resp3 := secPost(t, ts.URL, "/api/v1/auth/refresh", "", `{"refresh_token":"`+randHex(t)+`"}`)
	if resp3.StatusCode != 401 {
		t.Fatalf("refresh fabricado: esperado 401, obtido %d", resp3.StatusCode)
	}
}

// TestExtensionToken_RenovacaoJWT: o device renova o api_jwt curto pelo
// extension_token (hash no extension_devices) sem re-parear.
func TestExtensionToken_RenovacaoJWT(t *testing.T) {
	c := liveClient(t)
	srv, authSvc := liveServer(c)
	orgID, _, _ := secSeed(t, c, "sec-ext", "Sec E2E ExtToken")
	ts := secRouter(t, srv)

	// Pareamento real (código gerado autenticado + consumido publicamente).
	seedCtx, seedCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer seedCancel()
	var realUserID uuid.UUID
	if err := c.ExecWithTenant(seedCtx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(seedCtx, `SELECT id FROM users WHERE organization_id = $1 LIMIT 1`, orgID).Scan(&realUserID)
	}); err != nil {
		t.Fatalf("ler user seed: %v", err)
	}
	panelSID := uuid.New()
	panelToken, err := authSvc.GenerateTokenWithTTL(realUserID, orgID, "sec-ext@e2e", "owner", time.Hour, panelSID.String())
	if err != nil {
		t.Fatalf("gerar token painel: %v", err)
	}
	secInsertSession(t, c, orgID, realUserID, &panelSID, "panel", panelToken, time.Hour)

	genResp := secPost(t, ts.URL, "/api/v1/extension/pairing-code", panelToken, "")
	if genResp.StatusCode != 200 {
		t.Fatalf("pairing-code: esperado 200, obtido %d", genResp.StatusCode)
	}
	var genOut map[string]any
	_ = json.NewDecoder(genResp.Body).Decode(&genOut)
	code, _ := genOut["pairing_code"].(string)
	if code == "" {
		t.Fatalf("pairing-code sem código: %s", genOut)
	}

	pairResp := secPost(t, ts.URL, "/api/v1/extension/pair", "", `{"pairing_code":"`+code+`","device_name":"Chrome SecE2E"}`)
	if pairResp.StatusCode != 200 {
		t.Fatalf("pair: esperado 200, obtido %d", pairResp.StatusCode)
	}
	var pairOut map[string]any
	_ = json.NewDecoder(pairResp.Body).Decode(&pairOut)
	deviceToken, _ := pairOut["extension_token"].(string)
	if deviceToken == "" {
		t.Fatalf("pair sem extension_token: %s", pairOut)
	}

	// Renovação: Bearer extension_token → novo api_jwt (60min) com sessão viva.
	tokResp := secPost(t, ts.URL, "/api/v1/extension/token", deviceToken, "")
	if tokResp.StatusCode != 200 {
		t.Fatalf("extension/token: esperado 200, obtido %d", tokResp.StatusCode)
	}
	var tokOut map[string]any
	_ = json.NewDecoder(tokResp.Body).Decode(&tokOut)
	newJWT, _ := tokOut["api_jwt"].(string)
	if newJWT == "" {
		t.Fatalf("extension/token sem api_jwt: %s", tokOut)
	}
	claims, err := authSvc.ParseToken(newJWT)
	if err != nil || claims == nil || claims.OrganizationID != orgID {
		t.Fatalf("api_jwt renovado inválido ou de outro tenant: %v", err)
	}

	// Token de device fabricado → 401.
	if resp := secPost(t, ts.URL, "/api/v1/extension/token", randHex(t), ""); resp.StatusCode != 401 {
		t.Fatalf("extension/token falso: esperado 401, obtido %d", resp.StatusCode)
	}
}

// TestCORS_AllowlistEstrita: origem permitida recebe Access-Control-Allow-
// Origin; origem estranha NÃO recebe (navegador bloqueia).
func TestCORS_AllowlistEstrita(t *testing.T) {
	c := liveClient(t)
	srv, _ := liveServer(c)
	ts := secRouter(t, srv)

	cases := []struct {
		origin string
		want   bool
	}{
		{"http://localhost:3001", true},
		{"http://localhost:3000", true},
		{"chrome-extension://abcdefghijklmnop", true},
		{"https://evil.example", false},
		{"http://localhost:9999", false},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest("GET", ts.URL+"/health", nil)
		req.Header.Set("Origin", tc.origin)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("do request: %v", err)
		}
		acao := resp.Header.Get("Access-Control-Allow-Origin")
		resp.Body.Close()
		if tc.want && acao != tc.origin {
			t.Fatalf("origem %s: esperado ACAO=%s, obtido %q", tc.origin, tc.origin, acao)
		}
		if !tc.want && acao != "" {
			t.Fatalf("origem estranha %s: NÃO deveria receber ACAO, obteve %q", tc.origin, acao)
		}
	}

	// Preflight da origem permitida → 2xx com ACAO.
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/api/v1/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:3001")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		t.Fatalf("preflight: esperado 2xx, obtido %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3001" {
		t.Fatalf("preflight ACAO: esperado http://localhost:3001, obtido %q", got)
	}
}

// TestRateLimit_LoginBruteForce429: 15 tentativas seguidas de login com senha
// errada → o bucket de 10/min/IP devolve 429 RATE_LIMITED no fim da rajada.
// Precisa do Redis local (fail-open sem ele = limite desligado).
func TestRateLimit_LoginBruteForce429(t *testing.T) {
	c := liveClient(t)
	rdb, err := redisplatform.New("redis://:vibex_redis_pass_2026@localhost:6380/0")
	if err != nil {
		t.Skipf("redis local indisponível (limite desligado é o comportamento fail-open): %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	authSvc := auth.NewService("test-secret", time.Hour)
	srv := api.NewServerWithRedis(c, authSvc, safety.NewPlatformSafetyService(), events.NewBroker(), rdb, "")
	srv.StopOutreachWorker()
	ts := secRouter(t, srv)

	body := `{"email":"bruteforce-` + fmt.Sprint(time.Now().UnixNano()) + `@vibexcorp.com","password":"errado"}`
	sawRateLimited := false
	for i := 0; i < 15; i++ {
		resp := secPost(t, ts.URL, "/api/v1/auth/login", "", body)
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		if resp.StatusCode == 429 {
			if errObj, ok := out["error"].(map[string]any); ok && errObj["code"] == "RATE_LIMITED" {
				sawRateLimited = true
				break
			}
			t.Fatalf("429 sem code RATE_LIMITED: %s", out)
		}
		if resp.StatusCode != 401 {
			t.Fatalf("tentativa %d: esperado 401 antes do 429, obtido %d", i+1, resp.StatusCode)
		}
	}
	if !sawRateLimited {
		t.Fatalf("15 tentativas sem 429: bucket login não aplicou o limite de 10/min")
	}
}

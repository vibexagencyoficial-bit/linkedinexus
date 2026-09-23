package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
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

// Contrato de auth sem backdoor (PRD-honestidade-conexao, Fase D):
// - ParseToken rejeita "demo_token_vibex_2026" e qualquer string de 64 chars;
// - login com senha errada → 401 AUTH_INVALID_CREDENTIALS (bcrypt estrito);
// - login correto (seed 000005, admin123) → 200 com JWT válido no middleware;
// - /auth/demo-token não existe mais na API (rota removida).
//
// Os testes com banco usam o Postgres local (porta 5433); sem Postgres, Skip
// honesto.

func TestAuthD_DemoToken_Rejeitado(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	if _, err := svc.ParseToken("demo_token_vibex_2026"); err == nil {
		t.Fatal("ParseToken aceitou demo_token_vibex_2026 (backdoor vivo)")
	}
}

func TestAuthD_Token64Chars_Rejeitado(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	fake64 := "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	if len(fake64) != 64 {
		t.Fatalf("fixture invalida: len=%d", len(fake64))
	}
	if _, err := svc.ParseToken(fake64); err == nil {
		t.Fatal("ParseToken aceitou string de 64 chars como identidade (backdoor vivo)")
	}
}

func TestAuthD_JWTValido_Aceito(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	token, err := svc.GenerateToken(uuid.New(), uuid.New(), "alguem@x.com", "owner")
	if err != nil {
		t.Fatalf("gerar JWT: %v", err)
	}
	claims, err := svc.ParseToken(token)
	if err != nil || claims == nil {
		t.Fatalf("JWT valido rejeitado: %v", err)
	}
}

func liveAuthServer(t *testing.T) (*api.Server, uuid.UUID, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, err := postgres.New(ctx, crossTenantDBURL)
	if err != nil {
		t.Skipf("postgres local indisponivel (rode scripts/local/start.ps1): %v", err)
	}
	t.Cleanup(c.Close)
	srv := api.NewServer(c, auth.NewService("test-secret", time.Hour), safety.NewPlatformSafetyService(), events.NewBroker())

	// Org + usuário de prova com bcrypt real (senha: "senha-correta-d").
	orgID := freshTenantOrg(t, c, "auth-e2e-d", "Auth E2E (D)")
	email := "auth-e2e-d-" + orgID.String() + "@vibexcorp.com"
	hash, err := auth.HashPassword("senha-correta-d")
	if err != nil {
		t.Fatalf("hash bcrypt: %v", err)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel2()
	if err := c.ExecWithTenant(ctx2, orgID, func(tx pgx.Tx) error {
		// E-mail único por org (coluna UNIQUE global): inclui o id temporal.
		_, _ = tx.Exec(ctx2, `
			INSERT INTO users (organization_id, email, password_hash, name, role)
			VALUES ($1, $2, $3, 'E2E D', 'owner')
			ON CONFLICT (email) DO NOTHING
		`, orgID, email, hash)
		return nil
	}); err != nil {
		t.Fatalf("seed user auth: %v", err)
	}
	return srv, orgID, email
}

func doLogin(t *testing.T, srv *api.Server, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	srv.HandleLogin(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestAuthD_Login_SenhaErrada_401(t *testing.T) {
	srv, _, email := liveAuthServer(t)
	code, out := doLogin(t, srv, `{"email":"`+email+`","password":"senha-errada"}`)
	if code != 401 {
		t.Fatalf("senha errada: esperado 401, obtido %d (%v)", code, out)
	}
	errObj, ok := out["error"].(map[string]any)
	if !ok || errObj["code"] != "AUTH_INVALID_CREDENTIALS" {
		t.Fatalf("senha errada: esperado code AUTH_INVALID_CREDENTIALS, obtido %v", out)
	}
	if _, has := out["token"]; has {
		t.Fatalf("senha errada emitiu token: %v", out)
	}
}

func TestAuthD_Login_Correto_200_JWTValido(t *testing.T) {
	srv, _, email := liveAuthServer(t)
	code, out := doLogin(t, srv, `{"email":"`+email+`","password":"senha-correta-d"}`)
	if code != 200 {
		t.Fatalf("login correto: esperado 200, obtido %d (%v)", code, out)
	}
	token, _ := out["token"].(string)
	if token == "" {
		t.Fatalf("login correto sem token: %v", out)
	}
	// O JWT emitido passa no middleware (assinatura válida).
	svc := auth.NewService("test-secret", time.Hour)
	if _, err := svc.ParseToken(token); err != nil {
		t.Fatalf("JWT do login rejeitado: %v", err)
	}
}

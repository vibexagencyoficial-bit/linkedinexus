package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/api"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/events"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
)

// Contrato honesto (PRD-honestidade-conexao, Fase A2): sem Postgres os endpoints
// protegidos retornam 503 STORE_UNAVAILABLE - nunca dado ficticio com 200.

func newNoStoreServer() *api.Server {
	return api.NewServer(
		nil,
		auth.NewService("test-secret", time.Hour),
		safety.NewPlatformSafetyService(),
		events.NewBroker(),
	)
}

func mustTestUUID(s string) uuid.UUID {
	return uuid.MustParse(s)
}

// withTestClaims injeta os claims no contexto do request, reproduzindo o que
// auth.Middleware faz após validar o JWT (os handlers leem via GetClaims).
func withTestClaims(req *http.Request, token string) *http.Request {
	svc := auth.NewService("test-secret", time.Hour)
	claims, err := svc.ParseToken(token)
	if err != nil || claims == nil {
		return req
	}
	ctx := context.WithValue(req.Context(), auth.UserClaimsKey, claims)
	return req.WithContext(ctx)
}

func doAuthedJSON(t *testing.T, srv *api.Server, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	// Sessão de teste com tenant: o JWT carrega orgID válido, então o handler
	// passa pelo gate de tenant e chega ao cheque de store (503 sem Postgres).
	authSvc := auth.NewService("test-secret", time.Hour)
	token, err := authSvc.GenerateToken(
		mustTestUUID("00000000-0000-0000-0000-000000000002"),
		mustTestUUID("00000000-0000-0000-0000-000000000001"),
		"test@vibexcorp.com",
		"owner",
	)
	if err != nil {
		t.Fatalf("falha ao gerar token de teste: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req = withTestClaims(req, token)
	rec := httptest.NewRecorder()
	routeTestRequest(t, srv, rec, req, method, path)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func routeTestRequest(t *testing.T, srv *api.Server, rec *httptest.ResponseRecorder, req *http.Request, method, path string) {
	t.Helper()
	switch path {
	case "/api/v1/extension/pairing-code":
		srv.HandleGeneratePairingCode(rec, req)
	case "/api/v1/extension/pair":
		srv.HandlePairExtension(rec, req)
	case "/api/v1/extension/status":
		srv.HandleExtensionStatus(rec, req)
	case "/api/v1/accounts/connect":
		srv.HandleConnectAccount(rec, req)
	case "/api/v1/auth/login":
		srv.HandleLogin(rec, req)
	default:
		t.Fatalf("rota nao mapeada no switch de teste: %s", path)
	}
}

func doJSON(t *testing.T, srv *api.Server, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	routeTestRequest(t, srv, rec, req, method, path)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func assertStoreUnavailable(t *testing.T, rec *httptest.ResponseRecorder, out map[string]any) {
	t.Helper()
	if rec.Code != 503 {
		t.Fatalf("esperado 503, obtido %d (body: %s)", rec.Code, rec.Body.String())
	}
	errObj, ok := out["error"].(map[string]any)
	if !ok {
		t.Fatalf("esperado objeto error no body, obtido: %s", rec.Body.String())
	}
	if errObj["code"] != "STORE_UNAVAILABLE" {
		t.Fatalf("esperado code STORE_UNAVAILABLE, obtido %v", errObj["code"])
	}
}

func TestHonesty_NoStore_PairExtension_Returns503(t *testing.T) {
	srv := newNoStoreServer()
	rec, out := doJSON(t, srv, "POST", "/api/v1/extension/pair", `{"pairing_code":"ABC123","device_name":"Chrome"}`)
	assertStoreUnavailable(t, rec, out)
	if _, has := out["extension_token"]; has {
		t.Fatalf("endpoint fabricou extension_token sem store: %s", rec.Body.String())
	}
}

func TestHonesty_NoStore_GeneratePairingCode_Returns503(t *testing.T) {
	srv := newNoStoreServer()
	rec, out := doAuthedJSON(t, srv, "POST", "/api/v1/extension/pairing-code", `{}`)
	assertStoreUnavailable(t, rec, out)
	if _, has := out["pairing_code"]; has {
		t.Fatalf("endpoint fabricou pairing_code sem store: %s", rec.Body.String())
	}
}

func TestHonesty_NoStore_ConnectAccount_Returns503(t *testing.T) {
	srv := newNoStoreServer()
	rec, out := doAuthedJSON(t, srv, "POST", "/api/v1/accounts/connect", `{"display_name":"Perfil Teste"}`)
	assertStoreUnavailable(t, rec, out)
	if st, _ := out["status"].(string); st == "connected" {
		t.Fatalf("endpoint fabricou connected=true sem store: %s", rec.Body.String())
	}
}

func TestHonesty_NoStore_ExtensionStatus_Returns503(t *testing.T) {
	srv := newNoStoreServer()
	rec, out := doAuthedJSON(t, srv, "GET", "/api/v1/extension/status", ``)
	assertStoreUnavailable(t, rec, out)
	if c, _ := out["connected"].(bool); c {
		t.Fatalf("status fabricou connected=true sem store: %s", rec.Body.String())
	}
}

func TestHonesty_NoTenant_Returns401(t *testing.T) {
	// Sem JWT (sem claims de tenant) os handlers protegidos respondem 401
	// UNAUTHENTICATED — nunca assumem a org default, nunca tocam o store.
	srv := newNoStoreServer()
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/v1/extension/pairing-code", `{}`},
		{"POST", "/api/v1/accounts/connect", `{"display_name":"Perfil Teste"}`},
		{"GET", "/api/v1/extension/status", ``},
	} {
		rec, out := doJSON(t, srv, tc.method, tc.path, tc.body)
		if rec.Code != 401 {
			t.Fatalf("%s %s: esperado 401, obtido %d (body: %s)", tc.method, tc.path, rec.Code, rec.Body.String())
		}
		errObj, ok := out["error"].(map[string]any)
		if !ok || errObj["code"] != "UNAUTHENTICATED" {
			t.Fatalf("%s %s: esperado code UNAUTHENTICATED, obtido: %s", tc.method, tc.path, rec.Body.String())
		}
	}
}

func TestHonesty_NoStore_Login_Returns503(t *testing.T) {
	srv := newNoStoreServer()
	rec, out := doJSON(t, srv, "POST", "/api/v1/auth/login", `{"email":"admin@vibexcorp.com","password":"admin123"}`)
	assertStoreUnavailable(t, rec, out)
	if _, has := out["token"]; has {
		t.Fatalf("login fabricou token sem store (bootstrap): %s", rec.Body.String())
	}
}

func TestHonesty_NoStore_Login_Admin123Universal_Rejeitado(t *testing.T) {
	// O backdoor universal admin123 nao pode autenticar email nenhum: sem store
	// nem chega a autenticar (503) e, com store, a validacao e estrita por bcrypt.
	srv := newNoStoreServer()
	rec, out := doJSON(t, srv, "POST", "/api/v1/auth/login", `{"email":"outra@pessoa.com","password":"admin123"}`)
	assertStoreUnavailable(t, rec, out)
	if _, has := out["token"]; has {
		t.Fatalf("backdoor admin123 emitiu token: %s", rec.Body.String())
	}
}

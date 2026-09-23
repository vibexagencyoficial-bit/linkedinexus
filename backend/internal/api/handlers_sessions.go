package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Sessões DB-backed e TEMPORÁRIAS (pipeline honesto de credenciais):
//   - painel:  access JWT 15min  + refresh 7d (rotacionado a cada refresh)
//   - extensão: api_jwt 60min    + extension_token 30d (device, hash na
//     extension_devices — renovação via POST /extension/token)
//
// Toda sessão é revogável em O(1) (revoked_at) e o middleware exige sessão
// viva — JWT assinado mas revogado no banco NÃO autentica.

const (
	panelAccessTTL  = 15 * time.Minute
	refreshTTL      = 7 * 24 * time.Hour
	extensionJWTTL  = 60 * time.Minute
	deviceTokenTTL  = 30 * 24 * time.Hour
)

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// insertAuthSession grava a sessão por hash (org-scoped via RLS). O id da
// linha DEVE ser o sid embutido no JWT: o validator busca a sessão pelo sid —
// ids independentes deixariam todo token emitido inválido.
func insertAuthSession(ctx context.Context, s *Server, orgID, userID uuid.UUID, deviceID *uuid.UUID, sessionID uuid.UUID, kind, tokenHash string, ttl time.Duration) error {
	return s.pgClient.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO auth_sessions (id, organization_id, user_id, device_id, token_hash, kind, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, sessionID, orgID, userID, deviceID, tokenHash, kind, time.Now().Add(ttl))
		return err
	})
}

// lookupSessionByHash resolve a sessão pelo HASH sem contexto de tenant
// (refresh chega sem JWT; middleware valida antes do handler). Retorna a
// sessão e já toca last_used_at.
func (s *Server) lookupSessionByHash(ctx context.Context, tokenHash string) (orgID, userID uuid.UUID, sessionID uuid.UUID, kind string, expiresAt time.Time, err error) {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, "", time.Time{}, errors.New("store unavailable")
	}
	tx, err := s.pgClient.Pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, "", time.Time{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT set_config('app.session_lookup', 'on', true)`); err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, "", time.Time{}, err
	}
	err = tx.QueryRow(ctx, `
		UPDATE auth_sessions
		SET last_used_at = NOW()
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
		RETURNING id, organization_id, user_id, kind, expires_at
	`, tokenHash).Scan(&sessionID, &orgID, &userID, &kind, &expiresAt)
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, "", time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, uuid.Nil, uuid.Nil, "", time.Time{}, err
	}
	return orgID, userID, sessionID, kind, expiresAt, nil
}

// sessionValidatorMW é o gancho chamado pelo auth.Middleware a cada request
// com sid no JWT: sessão tem que estar viva (não revogada, não expirada).
func (s *Server) sessionValidatorMW(ctx context.Context, sid string) error {
	sessionID, err := uuid.Parse(sid)
	if err != nil {
		return err
	}
	if s.pgClient == nil || s.pgClient.Pool == nil {
		return errors.New("store unavailable")
	}
	tx, err := s.pgClient.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.session_lookup', 'on', true)`); err != nil {
		return err
	}
	var one int
	return tx.QueryRow(ctx, `
		SELECT 1 FROM auth_sessions
		WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
	`, sessionID).Scan(&one)
}

// revokeSessionsByUser revoga todas as sessões do usuário (logout).
func (s *Server) revokeSessionsByUser(ctx context.Context, orgID, userID uuid.UUID) error {
	return s.pgClient.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE auth_sessions SET revoked_at = NOW()
			WHERE user_id = $1 AND revoked_at IS NULL
		`, userID)
		return err
	})
}

// revokeExtensionSessions revoga as sessões de extensão do device/org
// (usado pelo Desconectar para forçar unpair via 401).
func (s *Server) revokeExtensionSessions(ctx context.Context, orgID uuid.UUID) error {
	return s.pgClient.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE auth_sessions SET revoked_at = NOW()
			WHERE organization_id = $1 AND kind = 'extension' AND revoked_at IS NULL
		`, orgID)
		return err
	})
}

// --- Endpoints ---

// HandleExtensionToken (público; auth por extension_token → token_hash):
// renova o api_jwt curto da extensão (60min) sem re-parear. 401 → a extensão
// faz unpair local.
func (s *Server) HandleExtensionToken(w http.ResponseWriter, r *http.Request) {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return
	}

	authHeader := r.Header.Get("Authorization")
	parts := splitBearer(authHeader)
	if parts == "" {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "extension token required", nil)
		return
	}

	// Mesma resolução do heartbeat: device pelo hash do token (policy 000008).
	tx, err := s.pgClient.Pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to open store transaction", nil)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT set_config('app.device_lookup', 'on', true)`); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to set device lookup mode", nil)
		return
	}

	var deviceID, orgID, userID uuid.UUID
	err = tx.QueryRow(r.Context(), `
		SELECT id, organization_id, user_id
		FROM extension_devices
		WHERE token_hash = $1 AND status = 'active'
		  AND (token_expires_at IS NULL OR token_expires_at > NOW())
	`, hashToken(parts)).Scan(&deviceID, &orgID, &userID)
	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "extension token invalid, expired or revoked", nil)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to finish device lookup", nil)
		return
	}

	// Emissão do novo JWT curto + sessão correspondente.
	var email, role string
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `SELECT email, role FROM users WHERE id = $1`, userID).Scan(&email, &role)
	}); err != nil {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "device owner not found", nil)
		return
	}

	sessionID := uuid.New()
	jwtToken, err := s.authService.GenerateTokenWithTTL(userID, orgID, email, role, extensionJWTTL, sessionID.String())
	if err != nil || jwtToken == "" {
		writeAPIError(w, http.StatusInternalServerError, "TOKEN_ISSUANCE_FAILED", "failed to sign session token", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, userID, &deviceID, sessionID, "extension", hashToken(jwtToken), extensionJWTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "TOKEN_ISSUANCE_FAILED", "failed to persist session", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"api_jwt":     jwtToken,
		"expires_in":  int(extensionJWTTL.Seconds()),
		"token_type":  "Bearer",
	})
}

// splitBearer extrai o token de um header "Bearer <token>".
func splitBearer(header string) string {
	parts := strings.SplitN(strings.TrimSpace(header), " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// HandleRefreshDB (público): rotação REAL de refresh token. Body:
// {"refresh_token": "..."} → valida por hash, revoga o antigo, emite novo
// par access (15min) + refresh (7d). JWT vencido nunca mais é "renovado"
// re-assinando a si mesmo.
func (s *Server) HandleRefreshDB(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "refresh_token is required", nil)
		return
	}

	orgID, userID, _, kind, _, err := s.lookupSessionByHash(r.Context(), hashToken(req.RefreshToken))
	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "refresh token invalid, expired or revoked", nil)
		return
	}
	if kind != "refresh" {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "token is not a refresh token", nil)
		return
	}

	// Revoga o refresh usado (rotação: cada refresh token vale UMA vez).
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `
			UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1
		`, hashToken(req.RefreshToken))
		return err
	}); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to rotate session", nil)
		return
	}

	var email, role string
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `SELECT email, role FROM users WHERE id = $1`, userID).Scan(&email, &role)
	}); err != nil {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user not found", nil)
		return
	}

	accessSession := uuid.New()
	access, err := s.authService.GenerateTokenWithTTL(userID, orgID, email, role, panelAccessTTL, accessSession.String())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to generate access token", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, userID, nil, accessSession, "panel", hashToken(access), panelAccessTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to persist session", nil)
		return
	}

	newRefresh, err := randomToken()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to generate refresh token", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, userID, nil, uuid.New(), "refresh", hashToken(newRefresh), refreshTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to persist refresh session", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":         access,
		"refresh_token": newRefresh,
		"expires_in":    int(panelAccessTTL.Seconds()),
	})
}

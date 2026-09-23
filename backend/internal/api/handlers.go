package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/events"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/messaging"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/ratelimit"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/templates"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	redisplatform "github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/telemetry"
)

// Fase E: sem store em memória — todo estado vive no Postgres sob RLS.
// Nenhum handler fabrica dado local; sem store a resposta é 503 honesto.

type Server struct {
	pgClient      *postgres.Client
	authService   *auth.Service
	safetyService *safety.PlatformSafetyService
	broker        *events.Broker
	renderer      *templates.Renderer
	provider      messaging.MessagingProvider
	rateLimiter   *ratelimit.RateLimiter
	redisClient   *redisplatform.Client
	extensionZip  string // caminho do zip servido em /downloads/extension.zip
	assist        *AssistService
	workerStop    chan struct{}
}

func NewServer(
	pgClient *postgres.Client,
	authService *auth.Service,
	safetyService *safety.PlatformSafetyService,
	broker *events.Broker,
) *Server {
	return NewServerWithRedis(pgClient, authService, safetyService, broker, nil, "")
}

// NewServerWithRedis permite injetar o rate limiter Redis (fila de dispacho
// diário) e o caminho do zip da extensão. redisClient nil = limites em modo
// degradado (worker aplica só cooldown local por contato).
func NewServerWithRedis(
	pgClient *postgres.Client,
	authService *auth.Service,
	safetyService *safety.PlatformSafetyService,
	broker *events.Broker,
	redisClient *redisplatform.Client,
	extensionZipPath string,
) *Server {
	var rl *ratelimit.RateLimiter
	if redisClient != nil {
		rl = ratelimit.NewRateLimiter(redisClient)
	}
	srv := &Server{
		pgClient:      pgClient,
		authService:   authService,
		safetyService: safetyService,
		broker:        broker,
		renderer:      templates.NewRenderer(),
		provider:      messaging.NewLinkedInProvider("https://api.linkedin.com"),
		rateLimiter:   rl,
		redisClient:   redisClient,
		extensionZip:  extensionZipPath,
		assist:        NewAssistServiceFromEnv(),
		workerStop:    make(chan struct{}),
	}
	srv.startOutreachWorker()
	// Sessões DB-backed: JWT com sid só autentica com sessão viva no banco.
	srv.authService.SetSessionValidator(srv.sessionValidatorMW)
	return srv
}

// JSON helpers
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// Section 41: Standard Error Contract
type APIError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func writeAPIError(w http.ResponseWriter, status int, code, msg string, details map[string]any) {
	if details == nil {
		details = make(map[string]any)
	}
	writeJSON(w, status, map[string]any{
		"error": APIError{
			Code:    code,
			Message: msg,
			Details: details,
		},
	})
}

// --- Auth Endpoints (Section 4) ---

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "email and password are required", nil)
		return
	}

	var userID, orgID uuid.UUID
	var passHash, name, role string

	if s.pgClient == nil || s.pgClient.Pool == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return
	}

	// Lookup pre-tenant: o RLS de users isola por organizacao, mas no login a org
	// ainda e desconhecida. A policy users_login_lookup (migration 000006) libera
	// o SELECT apenas com o modo setado transacionalmente (nunca vaza para a
	// conexao poolada).
	tx, err := s.pgClient.Pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to open store transaction", nil)
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(), `SELECT set_config('app.login_lookup', 'on', true)`); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to set login lookup mode", nil)
		return
	}

	err = tx.QueryRow(r.Context(), `
		SELECT id, organization_id, password_hash, name, role
		FROM users
		WHERE LOWER(email) = $1
	`, email).Scan(&userID, &orgID, &passHash, &name, &role)

	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "invalid email or password", nil)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to finish login lookup", nil)
		return
	}

	if !auth.CheckPassword(req.Password, passHash) {
		writeAPIError(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "invalid email or password", nil)
		return
	}

	// Credenciais TEMPORÁRIAS DB-backed: access JWT 15min (amarrado a sessão
	// revogável) + refresh token 7d rotacionado no banco. Nada de 72h eterno.
	accessSession := uuid.New()
	token, err := s.authService.GenerateTokenWithTTL(userID, orgID, email, role, panelAccessTTL, accessSession.String())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to generate session token", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, userID, nil, accessSession, "panel", hashToken(token), panelAccessTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to persist session", nil)
		return
	}
	refreshToken, err := randomToken()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to generate refresh token", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, userID, nil, uuid.New(), "refresh", hashToken(refreshToken), refreshTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "AUTH_TOKEN_GENERATION_FAILED", "failed to persist refresh session", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":         token,
		"refresh_token": refreshToken,
		"expires_in":    int(panelAccessTTL.Seconds()),
		"user": map[string]any{
			"id":              userID,
			"organization_id": orgID,
			"email":           email,
			"name":            name,
			"role":            role,
		},
	})
}

func (s *Server) HandleLogout(w http.ResponseWriter, r *http.Request) {
	// Best-effort: revoga a sessão do JWT atual (sid) e as do usuário.
	if claims, ok := auth.GetClaims(r.Context()); ok {
		_ = s.revokeSessionsByUser(r.Context(), claims.OrganizationID, claims.UserID)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (s *Server) HandleMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.GetClaims(r.Context())
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "session required", nil)
		return
	}

	// Nome REAL do usuário autenticado (nunca nome fictício hardcoded).
	name := claims.Email
	if !s.withTenantDB(w, r, claims.OrganizationID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `
			SELECT name FROM users WHERE id = $1
		`, claims.UserID).Scan(&name); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil // cai no email como nome
			}
			return err
		}
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":              claims.UserID,
			"organization_id": claims.OrganizationID,
			"email":           claims.Email,
			"name":            name,
			"role":            claims.Role,
		},
	})
}

// --- B2: tenant context helper (PRD-honestidade-conexao, Fase B2) ---//
// Todo acesso ao Postgres passa por este helper: sem JWT com orgID válido o
// handler retorna 401 UNAUTHENTICATED (sem fallback para a org default), e a
// query roda numa transação com SET LOCAL app.organization_id via
// ExecWithTenant — nunca na conexão poolada, onde o estado vazaria.

// requireTenant extrai o orgID dos claims do middleware. Handlers protegidos
// sempre rodam atrás de auth.Middleware; claims ausentes ou sem orgID são
// rejeitados de forma honesta em vez de assumirem a organização default.
func requireTenant(r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	claims, ok := auth.GetClaims(r.Context())
	if !ok || claims == nil || claims.OrganizationID == uuid.Nil {
		return uuid.Nil, uuid.Nil, false
	}
	return claims.OrganizationID, claims.UserID, true
}

// tenantOr401 responde 401 UNAUTHENTICATED quando não há tenant resolvido.
func tenantOr401(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	orgID, userID, ok := requireTenant(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "valid session with organization required", nil)
		return uuid.Nil, uuid.Nil, false
	}
	return orgID, userID, true
}

// errCampaignNotOwned sinaliza campanha inexistente ou de outro tenant
// dentro da transação (o handler converte em 404 CAMPAIGN_NOT_FOUND).
var errCampaignNotOwned = errors.New("campaign not owned by tenant")

// errContactNotFound sinaliza contato inexistente ou de outro tenant
// dentro da transação (o handler converte em 404 CONTACT_NOT_FOUND).
var errContactNotFound = errors.New("contact not owned by tenant")

// tenantTxErr guarda o erro da última transação com tenant para que o
// handler distinga "não pertence ao tenant" (404) de falha real (503).
var tenantTxErr error

// withTenantDB abre a transação com contexto de tenant e executa fn.
// Sem store retorna 503 STORE_UNAVAILABLE honesto (A2); qualquer erro de
// abertura/contexto/commit também é 503 — nunca dado fictício com 200.
func (s *Server) withTenantDB(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, fn func(tx pgx.Tx) error) bool {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		tenantTxErr = nil
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return false
	}
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, fn); err != nil {
		tenantTxErr = err
		if errors.Is(err, errCampaignNotOwned) || errors.Is(err, errContactNotFound) || errors.Is(err, errEvidenceRequired) {
			return false // handler decide o 404/428; nada respondido aqui
		}
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "database transaction failed", map[string]any{"detail": err.Error()})
		return false
	}
	tenantTxErr = nil
	return true
}

// --- LinkedIn Account & Capabilities (Section 7, 8, 9) ---

type ConnectAccountRequest struct {
	DisplayName string `json:"display_name"`
	ProfileURL  string `json:"profile_url"`
	SessionKey  string `json:"session_key"`
}

func (s *Server) HandleCurrentAccount(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var (
		id                                 uuid.UUID
		name, status, cbState              string
		dailyLimit                         int
		lastSeen                           *time.Time
		profileRead, connRead, msgAvail    bool
		found                              bool
	)

	// Conta nunca conectada = disconnected honesto (200), não 503:
	// ErrNoRows é absorvido no callback, qualquer outro erro aborta em 503.
	storeOK := s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `
			SELECT id, display_name, connection_status, circuit_breaker_state, daily_limit, last_seen_at
			FROM linkedin_accounts
			WHERE organization_id = $1
			ORDER BY updated_at DESC
			LIMIT 1
		`, orgID).Scan(&id, &name, &status, &cbState, &dailyLimit, &lastSeen); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}

		if err := tx.QueryRow(r.Context(), `
			SELECT profile_read, connections_read, messaging_available
			FROM linkedin_account_capabilities
			WHERE linkedin_account_id = $1
		`, id).Scan(&profileRead, &connRead, &msgAvail); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				found = true
				return nil
			}
			return err
		}

		found = true
		return nil
	})
	if !storeOK {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	// VERDADE ÚNICA: "connected" exige a flag no banco E um device da extensão
	// realmente pareado com heartbeat recente (≤2min). A flag sozinha nunca
	// mais mantém o painel "CONECTADA" com a extensão fora do ar.
	liveDevice := false
	if found {
		_ = s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
			var recent int
			if err := tx.QueryRow(r.Context(), `
				SELECT COUNT(*) FROM extension_devices
				WHERE organization_id = $1 AND status = 'active'
				  AND last_seen_at > NOW() - INTERVAL '2 minutes'
			`, orgID).Scan(&recent); err != nil {
				return err
			}
			liveDevice = recent > 0
			return nil
		})
	}
	connected := found && status == "connected" && liveDevice

	writeJSON(w, http.StatusOK, map[string]any{
		"connected":             connected,
		"live_device":           liveDevice,
		"id":                    id,
		"display_name":          name,
		"connection_status":     status,
		"circuit_breaker_state": cbState,
		"daily_limit":           dailyLimit,
		"last_seen_at":          lastSeen,
		"capabilities": map[string]bool{
			"profile_read":        profileRead,
			"connections_read":    connRead,
			"messaging_available": msgAvail,
		},
	})
}

// errEvidenceRequired sinaliza connect sem evidência de sessão verificável
// dentro da transação (o handler converte em 428 EVIDENCE_REQUIRED).
var errEvidenceRequired = errors.New("connect without verifiable session evidence")

func (s *Server) HandleConnectAccount(w http.ResponseWriter, r *http.Request) {
	orgID, userID, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var req ConnectAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	// Sem nome fictício: quando o frontend não manda display_name, usamos o
	// nome REAL do usuário autenticado (identidade vem do cadastro/sessão).
	if req.DisplayName == "" || req.DisplayName == "Lucas (LinkedIn Profile)" {
		var userName string
		if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
			return tx.QueryRow(r.Context(), `SELECT name FROM users WHERE id = $1`, userID).Scan(&userName)
		}); err == nil && strings.TrimSpace(userName) != "" {
			req.DisplayName = strings.TrimSpace(userName) + " (LinkedIn)"
		}
	}

	accountID := uuid.New()

	// Connect exige evidência verificável (PRD-honestidade-conexao, Fase C):
	// device active do tenant com heartbeat recente (<=2min) OU session_key
	// não-vazia (credencial de sessão verificável enviada pelo frontend).
	// Sem evidência → 428 EVIDENCE_REQUIRED honesto, nunca connected fictício.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if strings.TrimSpace(req.SessionKey) == "" {
			var recent int
			if err := tx.QueryRow(r.Context(), `
				SELECT COUNT(*) FROM extension_devices
				WHERE organization_id = $1 AND status = 'active'
				  AND last_seen_at > NOW() - INTERVAL '2 minutes'
			`, orgID).Scan(&recent); err != nil {
				return err
			}
			if recent == 0 {
				return errEvidenceRequired
			}
		}

		if err := tx.QueryRow(r.Context(), `
			INSERT INTO linkedin_accounts (
				organization_id, user_id, display_name, connection_status, daily_limit, last_seen_at
			) VALUES ($1, $2, $3, 'connected', 40, NOW())
			RETURNING id
		`, orgID, userID, req.DisplayName).Scan(&accountID); err != nil {
			return err
		}

		_, err := tx.Exec(r.Context(), `
			INSERT INTO linkedin_account_capabilities (
				organization_id, linkedin_account_id, profile_read, connections_read, messaging_available
			) VALUES ($1, $2, true, true, true)
			ON CONFLICT (linkedin_account_id) DO UPDATE SET
				profile_read = true, connections_read = true, messaging_available = true, updated_at = NOW()
		`, orgID, accountID)
		return err
	}) {
		if errors.Is(tenantTxErr, errEvidenceRequired) {
			writeAPIError(w, 428, "EVIDENCE_REQUIRED", "connect a extensão primeiro: nenhum device ativo com heartbeat recente e nenhuma session_key enviada", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	// Sem espelho em memória: a conta conectada vive no Postgres sob RLS
	// (CurrentAccount/ExtensionStatus leem de lá). Sem store → 503 acima.
	s.broker.Publish(orgID, "integration.updated", map[string]any{
		"account_id": accountID,
		"status":     "connected",
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "connected",
		"account_id": accountID,
		"message":    "LinkedIn account connected successfully",
	})
}

func (s *Server) HandleDisconnectAccount(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `
			UPDATE linkedin_accounts
			SET connection_status = 'disconnected', updated_at = NOW()
			WHERE organization_id = $1
		`, orgID); err != nil {
			return err
		}

		// Desconectar também revoga os devices pareados: a extensão recebe
		// 401 no heartbeat e faz unpair local (estado consistente dos dois
		// lados, sem "CONECTADA" órfão).
		if _, err := tx.Exec(r.Context(), `
			UPDATE extension_devices
			SET status = 'inactive', revoked_at = NOW(), last_seen_at = last_seen_at
			WHERE organization_id = $1 AND status = 'active'
		`, orgID); err != nil {
			return err
		}
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	s.broker.Publish(orgID, "integration.updated", map[string]string{"status": "disconnected"})
	// Revoga as sessões de extensão da org: o heartbeat/poll da extensão
	// recebe 401 e faz unpair local (auto-recuperação dos dois lados).
	_ = s.revokeExtensionSessions(r.Context(), orgID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// --- Browser Extension Pairing & Heartbeat (Section 10, 11) ---

func (s *Server) HandleGeneratePairingCode(w http.ResponseWriter, r *http.Request) {
	orgID, userID, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	bytes := make([]byte, 4)
	_, _ = rand.Read(bytes)
	code := strings.ToUpper(hex.EncodeToString(bytes))
	expiresAt := time.Now().Add(10 * time.Minute)

	// INSERT sujeito a RLS: exige o contexto do tenant dentro da transacao.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// Invalida códigos pendentes anteriores da org: só UM código vivo por
		// vez (o painel exibia código expirado/consumido e o usuário colava
		// código morto recebendo 404).
		if _, err := tx.Exec(r.Context(), `
			UPDATE extension_devices
			SET pairing_expires_at = NOW()
			WHERE organization_id = $1 AND status = 'pairing' AND pairing_expires_at > NOW()
		`, orgID); err != nil {
			return err
		}

		_, err := tx.Exec(r.Context(), `
			INSERT INTO extension_devices (
				organization_id, user_id, device_name, pairing_code, pairing_expires_at, token_hash, status
			) VALUES ($1, $2, 'Chrome Extension (Pending)', $3, $4, '', 'pairing')
		`, orgID, userID, code, expiresAt)
		return err
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"pairing_code": code,
		"expires_at":   expiresAt,
	})
}

type PairRequest struct {
	PairingCode string `json:"pairing_code"`
	DeviceName  string `json:"device_name"`
}

func (s *Server) HandlePairExtension(w http.ResponseWriter, r *http.Request) {
	var req PairRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	code := strings.ToUpper(strings.TrimSpace(req.PairingCode))
	if len(code) < 3 {
		writeAPIError(w, http.StatusBadRequest, "INVALID_PAIRING_CODE", "pairing code is invalid", nil)
		return
	}

	if s.pgClient == nil || s.pgClient.Pool == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return
	}

	// Generate high-entropy extension token
	tokenBytes := make([]byte, 32)
	_, _ = rand.Read(tokenBytes)
	rawToken := hex.EncodeToString(tokenBytes)
	hash := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(hash[:])

	// Pareamento pre-tenant: a extensao nao tem JWT; o codigo efemero e a credencial.
	// A policy extension_devices_pairing (migration 000007) libera o SELECT/UPDATE
	// apenas com o modo setado transacionalmente.
	tx, err := s.pgClient.Pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to open store transaction", nil)
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(), `SELECT set_config('app.pairing_lookup', 'on', true)`); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to set pairing lookup mode", nil)
		return
	}

	var deviceID, orgID, dbUserID uuid.UUID
	err = tx.QueryRow(r.Context(), `
		SELECT id, organization_id, user_id
		FROM extension_devices
		WHERE pairing_code = $1 AND pairing_expires_at > NOW() AND status = 'pairing'
		LIMIT 1
	`, code).Scan(&deviceID, &orgID, &dbUserID)

	if err != nil {
		// Codigo inexistente, expirado ou ja consumido: nada de token ficticio.
		writeAPIError(w, http.StatusNotFound, "INVALID_PAIRING_CODE", "pairing code invalid or expired", nil)
		return
	}

	// Pareamento também emite token de device TEMPORÁRIO (30d): sem credencial
	// eterna; a extensão re-vincula quando expira.
	if _, err := tx.Exec(r.Context(), `
		UPDATE extension_devices
		SET device_name = $1, token_hash = $2, status = 'active', pairing_code = NULL,
		    last_seen_at = NOW(), token_expires_at = $4
		WHERE id = $3
	`, "VibexCorp Chrome Extension MV3", tokenHash, deviceID, time.Now().Add(deviceTokenTTL)); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to persist device pairing", nil)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to finish pairing", nil)
		return
	}

	s.broker.Publish(orgID, "extension.paired", map[string]any{"device_id": deviceID})

	// Pipeline real: a extensão também recebe um JWT assinado (mesmo secret,
	// mesmo tenant/usuário do device pareado) para consumir /messaging/* e
	// /assist/* — o extension_token continua sendo a credencial do heartbeat
	// (resolve por token_hash na policy 000008).
	//
	// FALHA = 500 honesto (antes: `_ =` engolia o erro e a resposta 200
	// carregava api_jwt vazio — badge CONECTADA com polling morto).
	var email, role string
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			SELECT email, role FROM users WHERE id = $1
		`, dbUserID).Scan(&email, &role)
	}); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "PAIR_JWT_FAILED", "paired but failed to issue session token — tente parear novamente", nil)
		return
	}

	// JWT curto (60min) amarrado a sessão DB-backed revogável.
	sessionID := uuid.New()
	apiJWT, err := s.authService.GenerateTokenWithTTL(dbUserID, orgID, email, role, extensionJWTTL, sessionID.String())
	if err != nil || apiJWT == "" {
		writeAPIError(w, http.StatusInternalServerError, "PAIR_JWT_FAILED", "paired but failed to sign session token — tente parear novamente", nil)
		return
	}
	if err := insertAuthSession(r.Context(), s, orgID, dbUserID, &deviceID, sessionID, "extension", hashToken(apiJWT), extensionJWTTL); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "PAIR_JWT_FAILED", "paired but failed to persist session — tente parear novamente", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"device_id":       deviceID,
		"organization_id": orgID,
		"extension_token": rawToken,
		"api_jwt":         apiJWT,
		"status":          "active",
	})
}

func (s *Server) HandleExtensionHeartbeat(w http.ResponseWriter, r *http.Request) {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return
	}

	// O token da extensao (64 hex) nao carrega claims confiaveis: o dispositivo e
	// resolvido pelo hash do token no banco (par token_hash -> device criado no
	// pareamento). Sem device ativo correspondente, o heartbeat e rejeitado.
	authHeader := r.Header.Get("Authorization")
	parts := strings.SplitN(authHeader, " ", 2)
	rawToken := ""
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		rawToken = strings.TrimSpace(parts[1])
	}
	if rawToken == "" {
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "extension token required", nil)
		return
	}
	tokenHashBytes := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(tokenHashBytes[:])

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

	var deviceID, orgID uuid.UUID
	if err := tx.QueryRow(r.Context(), `
		SELECT id, organization_id
		FROM extension_devices
		WHERE token_hash = $1 AND status = 'active'
		  AND (token_expires_at IS NULL OR token_expires_at > NOW())
		LIMIT 1
	`, tokenHash).Scan(&deviceID, &orgID); err != nil {
		// Token expirado/revogado = 401: a extensão trata 401 como unpair.
		writeAPIError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "unknown, inactive or expired device", nil)
		return
	}

	now := time.Now()
	if _, err := tx.Exec(r.Context(), `
		UPDATE extension_devices
		SET last_seen_at = NOW()
		WHERE id = $1
	`, deviceID); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to persist heartbeat", nil)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to finish heartbeat", nil)
		return
	}

	// Sem espelho em memória: last_seen_at persiste em extension_devices e
	// ExtensionStatus lê de lá. Sem store → 503 acima.
	s.broker.Publish(orgID, "extension.heartbeat", map[string]any{"last_seen_at": now})

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "ok",
		"last_seen_at": now,
	})
}

func (s *Server) HandleExtensionStatus(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var (
		lastSeen          time.Time
		deviceName        string
		haveDevice        bool
	)

	// Sem device ativo do tenant (0 linhas sob RLS) = OFFLINE honesto (200);
	// ErrNoRows absorvido no callback, demais erros abortam em 503.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT device_name, last_seen_at
			FROM extension_devices
			WHERE organization_id = $1 AND status = 'active'
			ORDER BY last_seen_at DESC
			LIMIT 1
		`, orgID).Scan(&deviceName, &lastSeen)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		haveDevice = true
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	// connected significa exclusivamente: dispositivo active com heartbeat recente.
	isOnline := haveDevice && !lastSeen.IsZero() && time.Since(lastSeen) < 2*time.Minute

	currentStatus := "OFFLINE"
	deviceNameOut := ""
	if haveDevice {
		deviceNameOut = deviceName
	}
	if isOnline {
		currentStatus = "CONNECTED"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       currentStatus,
		"connected":    isOnline,
		"device_name":  deviceNameOut,
		"last_seen_at": lastSeen,
	})
}

// --- Contacts Endpoints (Section 14, 15) ---

// splitFullName decompõe "Full Name" em (first, last). "Bruno Costa" →
// ("Bruno", "Costa"); "Silva, Marcos" (formato "Sobrenome, Nome" do export do
// LinkedIn) → ("Marcos", "Silva"); nome único fica sem sobrenome.
func splitFullName(full string) (string, string) {
	if before, after, found := strings.Cut(full, ","); found {
		return strings.TrimSpace(after), strings.TrimSpace(before)
	}
	parts := strings.Fields(full)
	if len(parts) == 0 {
		return "", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}

type ContactInput struct {
	FirstName   string         `json:"first_name"`
	LastName    string         `json:"last_name"`
	FullName    string         `json:"full_name"`
	Company     string         `json:"company"`
	JobTitle    string         `json:"job_title"`
	LinkedInURL string         `json:"linkedin_url"`
	Metadata    map[string]any `json:"metadata"`
}

func (s *Server) HandleCreateContact(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	var in ContactInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	if in.FullName == "" && in.FirstName != "" {
		in.FullName = strings.TrimSpace(in.FirstName + " " + in.LastName)
	}
	// Listas reais frequentemente só trazem o nome completo (export do
	// LinkedIn): sem first/last o pipeline não renderiza {{first_name}} e o
	// worker para o contato com missing_variables. Decompõe na entrada.
	if in.FirstName == "" && in.FullName != "" {
		in.FirstName, in.LastName = splitFullName(in.FullName)
	}
	if in.LinkedInURL == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "linkedin_url is required", nil)
		return
	}

	contactID := uuid.New()
	metaJSON, _ := json.Marshal(in.Metadata)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO contacts (
				organization_id, first_name, last_name, full_name, company, job_title, linkedin_url, metadata
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (organization_id, linkedin_url) DO UPDATE SET
				first_name = EXCLUDED.first_name,
				last_name = EXCLUDED.last_name,
				full_name = EXCLUDED.full_name,
				company = EXCLUDED.company,
				job_title = EXCLUDED.job_title,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
			RETURNING id
		`, orgID, in.FirstName, in.LastName, in.FullName, in.Company, in.JobTitle, in.LinkedInURL, metaJSON).Scan(&contactID)
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	s.broker.Publish(orgID, "contact.created", map[string]any{"contact_id": contactID})

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":      contactID,
		"status":  "upserted",
		"message": "contact deduplicated and saved successfully",
	})
}

func (s *Server) HandleListContacts(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")

	contacts := []map[string]any{}

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT id, first_name, last_name, full_name, company, job_title, linkedin_url, status, created_at
			FROM contacts
			WHERE organization_id = $1
			  AND ($2 = '' OR status = $2)
			  AND ($3 = '' OR full_name ILIKE '%' || $3 || '%' OR company ILIKE '%' || $3 || '%')
			ORDER BY created_at DESC
			LIMIT 200
		`, orgID, status, search)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var fn, ln, full, comp, job, url, st string
			var cr time.Time
			if err := rows.Scan(&id, &fn, &ln, &full, &comp, &job, &url, &st, &cr); err == nil {
				contacts = append(contacts, map[string]any{
					"id":           id,
					"first_name":   fn,
					"last_name":    ln,
					"full_name":    full,
					"company":      comp,
					"job_title":    job,
					"linkedin_url": url,
					"status":       st,
					"created_at":   cr,
				})
			}
		}
		return rows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{"contacts": contacts, "total": len(contacts)})
}

func (s *Server) HandleGetContact(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	contactID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CONTACT_ID", "invalid contact id", nil)
		return
	}

	var (
		id                                       uuid.UUID
		fn, ln, full, comp, job, url, st         string
		metaJSON                                 []byte
		cr                                       time.Time
		found                                    bool
	)

	// Linha inexistente ou de outro tenant (RLS retorna zero linhas) =
	// CONTACT_NOT_FOUND honesto (404), não 503: ErrNoRows é absorvido.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT id, first_name, last_name, full_name, company, job_title, linkedin_url, status, metadata, created_at
			FROM contacts
			WHERE organization_id = $1 AND id = $2
		`, orgID, contactID).Scan(&id, &fn, &ln, &full, &comp, &job, &url, &st, &metaJSON, &cr)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		found = true
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	if !found {
		writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
		return
	}

	var meta map[string]any
	_ = json.Unmarshal(metaJSON, &meta)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":           id,
		"first_name":   fn,
		"last_name":    ln,
		"full_name":    full,
		"company":      comp,
		"job_title":    job,
		"linkedin_url": url,
		"status":       st,
		"metadata":     meta,
		"created_at":   cr,
	})
}

func (s *Server) HandleDeleteContact(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	contactID, _ := uuid.Parse(chi.URLParam(r, "id"))

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `
			DELETE FROM contacts WHERE organization_id = $1 AND id = $2
		`, orgID, contactID)
		return err
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) HandleImportContactsCSV(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "FILE_REQUIRED", "csv file required in 'file' multipart field", nil)
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "CSV_PARSE_FAILED", "failed to parse CSV header", nil)
		return
	}

	colIdx := make(map[string]int)
	for i, col := range header {
		// CSVs do mundo real chegam com BOM de export do Excel/Google e
		// cabeçalhos como "LinkedIn URL", "Full Name" (espaço em vez de
		// underscore): normaliza para casar com os aliases abaixo.
		norm := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(col, "\ufeff")))
		norm = strings.Join(strings.Fields(norm), "_")
		colIdx[norm] = i
	}

	// CSV inteiro numa única transação com tenant: ou importa tudo com
	// RLS correto ou responde 503 honesto (sem meia-importação).
	var inserted, skipped int
	type csvRow struct {
		fn, ln, full, comp, job, url string
	}
	rows := make([]csvRow, 0)
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			skipped++
			continue
		}

		getVal := func(keys ...string) string {
			for _, k := range keys {
				if idx, ok := colIdx[k]; ok && idx < len(record) {
					return strings.TrimSpace(record[idx])
				}
			}
			return ""
		}

		fn := getVal("first_name", "firstname", "nome")
		ln := getVal("last_name", "lastname", "sobrenome")
		full := getVal("full_name", "name", "nome_completo")
		comp := getVal("company", "empresa")
		job := getVal("job_title", "title", "cargo")
		url := getVal("linkedin_url", "linkedin", "profile", "url_do_linkedin", "url", "link")

		if full == "" && fn != "" {
			full = strings.TrimSpace(fn + " " + ln)
		}
		// Mesma decomposição do sync: "Full Name" sozinho precisa gerar
		// first/last, senão a cadência para com missing_variables.
		if fn == "" && full != "" {
			fn, ln = splitFullName(full)
		}
		if url == "" {
			skipped++
			continue
		}
		rows = append(rows, csvRow{fn, ln, full, comp, job, url})
	}

	batch := make([]pgx.NamedArgs, 0, len(rows))
	for _, row := range rows {
		batch = append(batch, pgx.NamedArgs{
			"org":  orgID,
			"fn":   row.fn,
			"ln":   row.ln,
			"full": row.full,
			"comp": row.comp,
			"job":  row.job,
			"url":  row.url,
		})
	}

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// INSERT em lote (pgx.Batch pipelined): COPY FROM não é suportado com
		// RLS ativa (SQLSTATE 0A000), então a importação não pode usar CopyFrom.
		const chunk = 500
		for start := 0; start < len(batch); start += chunk {
			end := start + chunk
			if end > len(batch) {
				end = len(batch)
			}
			b := &pgx.Batch{}
			for _, row := range batch[start:end] {
				b.Queue(`
					INSERT INTO contacts (organization_id, first_name, last_name, full_name, company, job_title, linkedin_url)
					VALUES (@org, @fn, @ln, @full, @comp, @job, @url)
				`, row)
			}
			if err := tx.SendBatch(r.Context(), b).Close(); err != nil {
				return err
			}
		}
		// Dedup pós-insert sob o mesmo tenant (mesma URL do LinkedIn: mantém
		// a última linha, que é a versão mais recente do arquivo).
		_, err := tx.Exec(r.Context(), `
			DELETE FROM contacts a USING contacts b
			WHERE a.organization_id = $1 AND b.organization_id = $1
			  AND a.linkedin_url = b.linkedin_url AND a.ctid < b.ctid
		`, orgID)
		return err
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	inserted = len(rows)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "completed",
		"inserted": inserted,
		"skipped":  skipped,
	})
}

type SyncLinkedInRequest struct {
	Connections []ContactInput `json:"connections"`
}

func (s *Server) HandleSyncLinkedInContacts(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var req SyncLinkedInRequest
	bodyBytes, _ := io.ReadAll(r.Body)
	if len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			var directList []ContactInput
			if err2 := json.Unmarshal(bodyBytes, &directList); err2 == nil {
				req.Connections = directList
			}
		}
	}

	// B2: sem conexões enviadas não há nada a sincronizar — corpo vazio
	// responde synced=0 honesto (o seed fictício de 5 contatos foi removido
	// na Fase E; ver §5 item 8 do PRD).
	if len(req.Connections) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "synced",
			"synced":       0,
			"synced_count": 0,
			"message":      "no connections provided to sync",
		})
		return
	}

	// Normaliza e deduplica por linkedin_url dentro do próprio payload.
	type syncRow struct {
		fn, ln, full, comp, job, url string
		meta                          []byte
	}
	seen := make(map[string]bool)
	rows := make([]syncRow, 0, len(req.Connections))
	for _, c := range req.Connections {
		if c.LinkedInURL == "" || seen[c.LinkedInURL] {
			continue
		}
		seen[c.LinkedInURL] = true
		full := c.FullName
		if full == "" && c.FirstName != "" {
			full = strings.TrimSpace(c.FirstName + " " + c.LastName)
		}
		fn, ln := c.FirstName, c.LastName
		if fn == "" && full != "" {
			fn, ln = splitFullName(full)
		}
		metaJSON, _ := json.Marshal(c.Metadata)
		rows = append(rows, syncRow{fn, ln, full, c.Company, c.JobTitle, c.LinkedInURL, metaJSON})
	}

	batch := make([][]any, 0, len(rows))
	for _, row := range rows {
		batch = append(batch, []any{orgID, row.fn, row.ln, row.full, row.comp, row.job, row.url, row.meta})
	}

	// Sync inteiro numa única transação com tenant. INSERT em lote
	// (pgx.Batch pipelined): COPY FROM não é suportado com RLS ativa
	// (SQLSTATE 0A000) — mesmo motivo do import CSV.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		const chunk = 500
		for start := 0; start < len(batch); start += chunk {
			end := start + chunk
			if end > len(batch) {
				end = len(batch)
			}
			b := &pgx.Batch{}
			for _, row := range batch[start:end] {
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
				`, row...)
			}
			if err := tx.SendBatch(r.Context(), b).Close(); err != nil {
				return err
			}
		}
		_, err := tx.Exec(r.Context(), `
			DELETE FROM contacts a USING contacts b
			WHERE a.organization_id = $1 AND b.organization_id = $1
			  AND a.linkedin_url = b.linkedin_url AND a.ctid < b.ctid
		`, orgID)
		return err
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	s.broker.Publish(orgID, "contacts.synced", map[string]any{"synced_count": len(rows)})

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "synced",
		"synced":       len(rows),
		"synced_count": len(rows),
		"message":      fmt.Sprintf("%d conexões sincronizadas com sucesso!", len(rows)),
	})
}

// --- Campaigns & Flow Builder (Section 16, 17, 18, 21, 22) ---

type CampaignInput struct {
	Name             string      `json:"name"`
	Description      string      `json:"description"`
	DailyLimit       int         `json:"daily_limit"`
	AllowedStartTime string      `json:"allowed_start_time"`
	AllowedEndTime   string      `json:"allowed_end_time"`
	Timezone         string      `json:"timezone"`
	IsFlowCustom     bool        `json:"is_flow_custom"`
	ContactIDs       []uuid.UUID `json:"contact_ids"` // vazio = todos os contatos da org
}

func (s *Server) HandleListCampaigns(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	list := []map[string]any{}

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT
				c.id, c.name, c.description, c.status, c.daily_limit, c.created_at,
				COALESCE(COUNT(cc.id), 0) AS total_contacts,
				COALESCE(COUNT(cc.id) FILTER (WHERE cc.status IN ('active', 'waiting')), 0) AS active_contacts,
				COALESCE(COUNT(cc.id) FILTER (WHERE cc.status = 'replied'), 0) AS replied_contacts,
				COALESCE(COUNT(cc.id) FILTER (WHERE cc.status = 'completed'), 0) AS completed_contacts
			FROM campaigns c
			LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
			WHERE c.organization_id = $1
			GROUP BY c.id
			ORDER BY c.created_at DESC
		`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var name, desc, status string
			var limit, total, active, replied, completed int
			var cr time.Time

			if err := rows.Scan(&id, &name, &desc, &status, &limit, &cr, &total, &active, &replied, &completed); err == nil {
				list = append(list, map[string]any{
					"id":                 id,
					"name":               name,
					"description":        desc,
					"status":             status,
					"daily_limit":        limit,
					"created_at":         cr,
					"total_contacts":     total,
					"active_contacts":    active,
					"replied_contacts":   replied,
					"completed_contacts": completed,
				})
			}
		}
		return rows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{"campaigns": list})
}

func (s *Server) HandleCreateCampaign(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	var in CampaignInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	if strings.TrimSpace(in.Name) == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "campaign name is required", nil)
		return
	}

	// Janela de envio é opcional no contrato: vazio vira NULL, nunca string
	// vazia (que estoura o cast ::time com 22007).
	if in.AllowedStartTime == "" {
		in.AllowedStartTime = "00:00:00"
	}
	if in.AllowedEndTime == "" {
		in.AllowedEndTime = "23:59:59"
	}

	campID := uuid.New()

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `
			INSERT INTO campaigns (
				organization_id, name, description, status, daily_limit,
				allowed_start_time, allowed_end_time, timezone, is_flow_custom
			) VALUES ($1, $2, $3, 'draft', $4, $5::time, $6::time, $7, $8)
			RETURNING id
		`, orgID, in.Name, in.Description, in.DailyLimit, in.AllowedStartTime, in.AllowedEndTime, in.Timezone, in.IsFlowCustom).Scan(&campID); err != nil {
			return err
		}
		// Lista selecionável por campanha (todos marcados no UI por default):
		// os contatos escolhidos entram na cadência já na criação; vazio =
		// campanha sem lista ainda (start popula com todos).
		return stageCampaignContacts(tx, orgID, campID, in.ContactIDs)
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	s.broker.Publish(orgID, "campaign.created", map[string]any{"campaign_id": campID})
	writeJSON(w, http.StatusCreated, map[string]any{"id": campID, "status": "draft"})
}

func (s *Server) HandleGetCampaign(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	var (
		id                                       uuid.UUID
		name, desc, status, tz                   string
		limit                                    int
		startTime, endTime                       time.Time
		isCustom                                 bool
		cr, up                                   time.Time
		startedAt, pausedAt                      *time.Time
		found                                    bool
	)

	// Campanha inexistente ou de outro tenant = CAMPAIGN_NOT_FOUND (404),
	// ErrNoRows absorvido no callback; demais erros abortam em 503.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT id, name, description, status, daily_limit, allowed_start_time, allowed_end_time,
			       timezone, is_flow_custom, started_at, paused_at, created_at, updated_at
			FROM campaigns
			WHERE organization_id = $1 AND id = $2
		`, orgID, campID).Scan(&id, &name, &desc, &status, &limit, &startTime, &endTime, &tz, &isCustom, &startedAt, &pausedAt, &cr, &up)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		found = true
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	if !found {
		writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":             id,
		"name":           name,
		"description":    desc,
		"status":         status,
		"daily_limit":    limit,
		"timezone":       tz,
		"is_flow_custom": isCustom,
		"created_at":     cr,
	})
}

type StepInput struct {
	Position     int            `json:"position"`
	StepType     string         `json:"step_type"`
	Name         string         `json:"name"`
	TemplateBody string         `json:"template_body"`
	DelayAmount  int            `json:"delay_amount"`
	DelayUnit    string         `json:"delay_unit"`
	Conditions   map[string]any `json:"conditions"`
}

type SaveStepsRequest struct {
	Steps []StepInput `json:"steps"`
}

func (s *Server) HandleGetCampaignSteps(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campUUID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	steps := []map[string]any{}

	// Steps da campanha do próprio tenant; campanha de outro tenant não
	// existe para este orgID (RLS) → lista vazia honesta, nunca step fixo.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT position, step_type, name, template_body, delay_amount, delay_unit, conditions
			FROM campaign_steps
			WHERE organization_id = $1 AND campaign_id = $2
			ORDER BY position ASC
		`, orgID, campUUID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var position, delayAmount int
			var stepType, name, templateBody, delayUnit string
			var condJSON []byte
			if err := rows.Scan(&position, &stepType, &name, &templateBody, &delayAmount, &delayUnit, &condJSON); err != nil {
				continue
			}
			var cond map[string]any
			_ = json.Unmarshal(condJSON, &cond)
			steps = append(steps, map[string]any{
				"position":      position,
				"step_type":     stepType,
				"name":          name,
				"template_body": templateBody,
				"delay_amount":  delayAmount,
				"delay_unit":    delayUnit,
				"conditions":    cond,
			})
		}
		return rows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{"steps": steps})
}

func (s *Server) HandleSaveCampaignSteps(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campStr := chi.URLParam(r, "id")
	campUUID, err := uuid.Parse(campStr)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}
	var req SaveStepsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	// Troca atômica dos steps sob o tenant: apaga e reinsere na mesma
	// transação; campanha de outro tenant não é afetada (0 linhas) e o
	// resultado informa quantos steps foram persistidos.
	var saved int
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		var owned bool
		if err := tx.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM campaigns WHERE organization_id = $1 AND id = $2)
		`, orgID, campUUID).Scan(&owned); err != nil {
			return err
		}
		if !owned {
			return errCampaignNotOwned
		}
		if _, err := tx.Exec(r.Context(), `
			DELETE FROM campaign_steps WHERE organization_id = $1 AND campaign_id = $2
		`, orgID, campUUID); err != nil {
			return err
		}
		for _, step := range req.Steps {
			condJSON, _ := json.Marshal(step.Conditions)
			if condJSON == nil {
				condJSON = []byte("{}")
			}
			if _, err := tx.Exec(r.Context(), `
				INSERT INTO campaign_steps (
					organization_id, campaign_id, position, step_type, name,
					template_body, delay_amount, delay_unit, conditions
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			`, orgID, campUUID, step.Position, step.StepType, step.Name,
				step.TemplateBody, step.DelayAmount, step.DelayUnit, condJSON); err != nil {
				return err
			}
			saved++
		}
		return nil
	}) {
		if errors.Is(tenantTxErr, errCampaignNotOwned) {
			writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "saved", "saved": saved})
}

type PreviewItem struct {
	ContactName string `json:"contact_name"`
	Company     string `json:"company"`
	Rendered    string `json:"rendered"`
	Blocked     bool   `json:"blocked"`
	MissingVar  string `json:"missing_var,omitempty"`
}

func (s *Server) HandleCampaignPreview(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campUUID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	// Preview honesto (Fase E): renderiza o template MESSAGE de menor posição
	// da campanha contra os contatos reais da cadência (tenant, RLS).
	// Campanha sem steps ou sem contatos = previews vazios + can_launch=false
	// (nunca "Lucas Silva"/can_launch:true fictícios).
	var (
		template   string
		haveSteps  bool
		canLaunch  bool
		previews   = []PreviewItem{}
	)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// Campanha precisa pertencer ao tenant.
		var exists int
		if err := tx.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM campaigns
			WHERE organization_id = $1 AND id = $2
		`, orgID, campUUID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return errCampaignNotOwned
		}

		if err := tx.QueryRow(r.Context(), `
			SELECT template_body FROM campaign_steps
			WHERE organization_id = $1 AND campaign_id = $2 AND step_type = 'MESSAGE'
			ORDER BY position ASC
			LIMIT 1
		`, orgID, campUUID).Scan(&template); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		haveSteps = true

		rows, err := tx.Query(r.Context(), `
			SELECT c.first_name, c.full_name, c.company, c.job_title
			FROM campaign_contacts cc
			JOIN contacts c ON c.id = cc.contact_id AND c.organization_id = $1
			WHERE cc.organization_id = $1 AND cc.campaign_id = $2
			ORDER BY cc.created_at ASC
			LIMIT 5
		`, orgID, campUUID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var fn, full, comp, job string
			if err := rows.Scan(&fn, &full, &comp, &job); err != nil {
				continue
			}
			rendered := template
			rendered = strings.ReplaceAll(rendered, "{{first_name}}", fn)
			rendered = strings.ReplaceAll(rendered, "{{full_name}}", full)
			rendered = strings.ReplaceAll(rendered, "{{company}}", comp)
			rendered = strings.ReplaceAll(rendered, "{{job_title}}", job)
			blocked := strings.Contains(rendered, "{{")
			missing := ""
			if blocked {
				if idx := strings.Index(rendered, "{{"); idx >= 0 {
					if end := strings.Index(rendered[idx:], "}}"); end >= 0 {
						missing = rendered[idx+2 : idx+end]
					}
				}
			}
			previews = append(previews, PreviewItem{
				ContactName: full,
				Company:     comp,
				Rendered:    rendered,
				Blocked:     blocked,
				MissingVar:  missing,
			})
		}
		return rows.Err()
	}) {
		if errors.Is(tenantTxErr, errCampaignNotOwned) {
			writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	if haveSteps && len(previews) > 0 {
		blocked := false
		for _, p := range previews {
			if p.Blocked {
				blocked = true
				break
			}
		}
		canLaunch = !blocked
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"previews":   previews,
		"can_launch": canLaunch,
	})
}

// stageCampaignContacts liga os contatos selecionados à campanha (o INSERT em
// campaign_contacts que faltava no pipeline). Valida que os ids pertencem à
// org (RLS: id de outra org não conta linha); dedup pelo UNIQUE(campaign,
// contact). Sem ids: no-op (campanha ainda sem lista).
func stageCampaignContacts(tx pgx.Tx, orgID, campID uuid.UUID, contactIDs []uuid.UUID) error {
	if len(contactIDs) == 0 {
		return nil
	}
	for _, cid := range contactIDs {
		if _, err := tx.Exec(context.Background(), `
			INSERT INTO campaign_contacts
				(organization_id, campaign_id, contact_id, status, current_position, next_execution_at, started_at)
			VALUES ($1, $2, $3, 'pending', 1, NULL, NULL)
			ON CONFLICT (campaign_id, contact_id) DO NOTHING
		`, orgID, campID, cid); err != nil {
			return err
		}
	}
	return nil
}

// populateAllContacts entra em cena quando a campanha é iniciada sem lista
// explicitamente escolhida: toda a base de contatos da org entra na cadência.
// Campanha de outra org → 0 linhas no guard → 404 honesto.
func (s *Server) populateAllContacts(w http.ResponseWriter, r *http.Request, orgID, campID uuid.UUID) bool {
	var owned bool
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM campaigns WHERE organization_id = $1 AND id = $2
			)
		`, orgID, campID).Scan(&owned); err != nil {
			return err
		}
		if !owned {
			return errCampaignNotOwned
		}
		_, err := tx.Exec(r.Context(), `
			INSERT INTO campaign_contacts
				(organization_id, campaign_id, contact_id, status, current_position, next_execution_at, started_at)
			SELECT $1, $2, id, 'pending', 1, NULL, NULL FROM contacts WHERE organization_id = $1
			ON CONFLICT (campaign_id, contact_id) DO NOTHING
		`, orgID, campID)
		return err
	}) {
		return false // 503 já respondido pelo helper (404 tratado abaixo)
	}
	if !owned {
		writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
		return false
	}
	return true
}

func (s *Server) HandleStartCampaign(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	// UPDATE restrito ao tenant: campanha de outra org não é tocada
	// (0 linhas) e vira 404 honesto; demais erros abortam em 503.
	var updated bool
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), `
			UPDATE campaigns
			SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
		`, orgID, campID)
		if err != nil {
			return err
		}
		updated = cmd.RowsAffected() > 0
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}
	if !updated {
		writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
		return
	}

	// Campanha iniciada sem lista escolhida: toda a base de contatos da org
	// entra na cadência (o pipeline real precisa das linhas em campaign_contacts
	// para existir; sem isso o worker nunca tinha trabalho).
	if !s.populateAllContacts(w, r, orgID, campID) {
		return
	}

	s.broker.Publish(orgID, "campaign.started", map[string]any{"campaign_id": campID})

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "running",
		"message": "campaign launched successfully and queued for scheduler",
	})
}

func (s *Server) HandlePauseCampaign(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	var updated bool
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), `
			UPDATE campaigns
			SET status = 'paused', paused_at = NOW(), updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
		`, orgID, campID)
		if err != nil {
			return err
		}
		updated = cmd.RowsAffected() > 0
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}
	if !updated {
		writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
		return
	}

	s.broker.Publish(orgID, "campaign.paused", map[string]any{"campaign_id": campID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "paused", "message": "campaign paused successfully"})
}

func (s *Server) HandleResumeCampaign(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	campID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CAMPAIGN_ID", "invalid campaign id", nil)
		return
	}

	var updated bool
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), `
			UPDATE campaigns
			SET status = 'running', updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
		`, orgID, campID)
		if err != nil {
			return err
		}
		updated = cmd.RowsAffected() > 0
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}
	if !updated {
		writeAPIError(w, http.StatusNotFound, "CAMPAIGN_NOT_FOUND", "campaign not found", nil)
		return
	}

	s.broker.Publish(orgID, "campaign.resumed", map[string]any{"campaign_id": campID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "running", "message": "campaign resumed successfully"})
}

type KillSwitchRequest struct {
	PauseAll bool `json:"pause_all"`
}

func (s *Server) HandleGlobalKillSwitch(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	var req KillSwitchRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	s.safetyService.SetGlobalKillSwitch(orgID, req.PauseAll)

	writeJSON(w, http.StatusOK, map[string]any{
		"kill_switch_active": req.PauseAll,
		"message":            "global safety state updated",
	})
}

func (s *Server) HandleSystemPauseOutreach(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	s.safetyService.SetGlobalKillSwitch(orgID, true)
	writeJSON(w, http.StatusOK, map[string]string{"status": "all_outreach_paused"})
}

func (s *Server) HandleListActivity(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	// Feed de auditoria do próprio tenant (RLS); conta sem eventos = lista
	// vazia honesta, nunca atividade de outro tenant.
	items := make([]map[string]any, 0)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT id, entity_type, entity_id, event_type, payload, created_at
			FROM events
			WHERE organization_id = $1
			ORDER BY created_at DESC
			LIMIT 50
		`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, entityID uuid.UUID
			var entityType, eventType string
			var payload []byte
			var createdAt time.Time
			if err := rows.Scan(&id, &entityType, &entityID, &eventType, &payload, &createdAt); err != nil {
				continue
			}
			var payloadMap map[string]any
			if len(payload) > 0 {
				_ = json.Unmarshal(payload, &payloadMap)
			}
			desc, _ := payloadMap["description"].(string)
			if desc == "" {
				desc = eventType
			}
			items = append(items, map[string]any{
				"id":          id,
				"entity_type": entityType,
				"entity_id":   entityID,
				"event_type":  eventType,
				"description": desc,
				"payload":     payloadMap,
				"created_at":  createdAt,
			})
		}
		return rows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{"activity": items})
}

func (s *Server) HandleDashboardMetrics(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var (
		activeCamps, contactsCount, contactedCount, replies int
		isExtConnected, isLiConnected                        bool
		extSeen                                              *time.Time
		jevAvg                                               *float64
		jevSamples                                            int
	)

	// Métricas agregadas no banco sob o tenant (RLS): zero linhas de outro
	// tenant jamais entram nas contagens. Sem store → 503 honesto.
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM campaigns
			WHERE organization_id = $1 AND status = 'running'
		`, orgID).Scan(&activeCamps); err != nil {
			return err
		}
		if err := tx.QueryRow(r.Context(), `
			SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'contacted'),
			       COUNT(*) FILTER (WHERE status = 'replied')
			FROM contacts WHERE organization_id = $1
		`, orgID).Scan(&contactsCount, &contactedCount, &replies); err != nil {
			return err
		}
		var liStatus *time.Time
		if err := tx.QueryRow(r.Context(), `
			SELECT MAX(last_seen_at) FROM extension_devices
			WHERE organization_id = $1 AND status = 'active'
		`, orgID).Scan(&extSeen); err != nil {
			return err
		}
		if err := tx.QueryRow(r.Context(), `
			SELECT MAX(last_seen_at) FROM linkedin_accounts
			WHERE organization_id = $1 AND connection_status = 'connected'
		`, orgID).Scan(&liStatus); err != nil {
			return err
		}
		isExtConnected = extSeen != nil && time.Since(*extSeen) < 2*time.Minute
		isLiConnected = liStatus != nil
		// Latência média do Jev (ms) nos disparos das últimas 24h: AVG/COUNT
		// sobre o campo jev_ms do payload message.sent. COALESCE trata NULL
		// (eventos antigos sem métrica): só conta quem tem valor > 0.
		var avg sql.NullFloat64
		if err := tx.QueryRow(r.Context(), `
			SELECT AVG((payload->>'jev_ms')::bigint), COUNT(*)
			FROM events
			WHERE organization_id = $1 AND event_type = 'message.sent'
			  AND created_at > NOW() - INTERVAL '24 hours'
			  AND COALESCE((payload->>'jev_ms')::bigint, 0) > 0
		`, orgID).Scan(&avg, &jevSamples); err != nil {
			return err
		}
		if avg.Valid {
			v := avg.Float64
			jevAvg = &v
		}
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"active_campaigns":    activeCamps,
		"contacts_in_seq":     contactsCount,
		"waiting_followups":   contactsCount - contactedCount - replies,
		"replies":             replies,
		"completed":           contactedCount,
		"telemetry_processed": telemetry.GlobalMetrics.JobsProcessed.Load(),
		"kill_switch_active":  s.safetyService.IsGlobalKillSwitchActive(orgID),
		"extension_connected": isExtConnected,
		"extension_last_seen": extSeen, // nulo = nunca sinalizou
		"linkedin_connected":  isLiConnected,
		"jev_avg_ms":          jevAvg, // nulo = sem amostras nas últimas 24h
		"jev_samples":         jevSamples,
	})
}

// Background outreach worker executing messages for active campaigns
func (s *Server) startOutreachWorker() {
	go func() {
		ticker := time.NewTicker(4 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-s.workerStop:
				return
			case <-ticker.C:
				s.processNextOutreachStep()
			}
		}
	}()
}

// StopOutreachWorker encerra o ticker do worker (usado nos testes E2E: um
// worker vivo de um teste anterior não pode processar a org de outro teste
// em andamento — o teste controla os ticks explicitamente).
func (s *Server) StopOutreachWorker() {
	select {
	case <-s.workerStop:
	default:
		close(s.workerStop)
	}
}

// O worker de outreach é multi-tenant: a cada tick itera as organizações com
// campanha running e executa um passo por org, cada um na sua transação com
// contexto RLS. O kill switch é por organização. Sem store ou sem campanhas,
// o tick é no-op (nunca escreve dado fictício nem usa org default).
//
// NOTA pipeline real: o worker NÃO marca mais "contacted" nem registra
// message.sent — ele só ENFILEIRA o trabalho (message_jobs 'queued') depois de
// passar pelos gates honestos. Quem confirma entrega é a extensão, via
// /messaging/report-sent (que avança a cadência de verdade).
func (s *Server) processNextOutreachStep() {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	orgIDs, err := s.listRunningOutreachOrgs(ctx)
	if err != nil {
		return
	}
	for _, orgID := range orgIDs {
		s.processNextOutreachStepForOrg(ctx, orgID)
	}
}

// listRunningOutreachOrgs devolve as orgs com campanha running. É uma leitura
// administrativa pré-tenant (agregação cross-tenant só para agendar o trabalho;
// cada passo executa depois sob RLS da própria org).
func (s *Server) listRunningOutreachOrgs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pgClient.Pool.Query(ctx, `
		SELECT DISTINCT organization_id FROM campaigns WHERE status = 'running'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orgs []uuid.UUID
	for rows.Next() {
		var orgID uuid.UUID
		if err := rows.Scan(&orgID); err != nil {
			continue
		}
		orgs = append(orgs, orgID)
	}
	return orgs, rows.Err()
}

// outreachCandidate é um contato pronto para o próximo passo da cadência.
type outreachCandidate struct {
	ContactID   uuid.UUID
	Position    int
	FirstName   string
	LastName    string
	FullName    string
	Company     string
	JobTitle    string
	LinkedInURL string
}

// ProcessOutreachStepForOrg expõe um tick do worker para uma org (usado pelos
// testes E2E do pipeline; em produção o ticker de 4s chama o mesmo caminho).
func (s *Server) ProcessOutreachStepForOrg(ctx context.Context, orgID uuid.UUID) {
	if s.pgClient == nil || s.pgClient.Pool == nil {
		return
	}
	s.processNextOutreachStepForOrg(ctx, orgID)
}

func (s *Server) processNextOutreachStepForOrg(ctx context.Context, orgID uuid.UUID) {
	if s.safetyService.IsGlobalKillSwitchActive(orgID) {
		return
	}

	// Passo executado numa transação com SET LOCAL app.organization_id: cada
	// query enxerga só as linhas da própria org (policies *_tenant_isolation).
	_ = s.pgClient.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		// GATE 1 — extensão viva (heartbeat <= 2 min). Sem device online nada
		// é enfileirado: a cadência espera (contrato honesto — nunca "enviar"
		// sem quem entregue).
		var deviceOnline bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM extension_devices
				WHERE organization_id = $1 AND status = 'active'
				  AND last_seen_at > NOW() - INTERVAL '2 minutes'
				  AND revoked_at IS NULL
			)
		`, orgID).Scan(&deviceOnline); err != nil || !deviceOnline {
			return nil
		}

		// Campanha running mais recente com janela de execução aberta agora.
		var campID uuid.UUID
		var campName string
		var dailyLimit int
		var windowStart, windowEnd time.Time
		var tz string
		if err := tx.QueryRow(ctx, `
			SELECT id, name, daily_limit, allowed_start_time, allowed_end_time, timezone
			FROM campaigns
			WHERE organization_id = $1 AND status = 'running'
			ORDER BY updated_at DESC
			LIMIT 1
		`, orgID).Scan(&campID, &campName, &dailyLimit, &windowStart, &windowEnd, &tz); err != nil {
			return nil // sem campanha running: tick no-op
		}
		if !withinExecutionWindow(windowStart, windowEnd, tz) {
			return nil
		}

		// GATE 2 — limite diário + cooldown (Redis). Erro de Redis = não é
		// possível respeitar o teto de segurança → não despacha neste tick.
		if s.rateLimiter != nil {
			ok, _, err := s.rateLimiter.CanExecuteAccount(ctx, orgID, dailyLimit)
			if err != nil || !ok {
				return nil
			}
		}

		// Avança passos não-MESSAGE (delays/condições) até achar o próximo
		// MESSAGE real ou esgotar a cadência do contato.
		candidates := s.pickOutreachCandidates(ctx, tx, orgID, campID)
		for _, cand := range candidates {
			step, ok := s.currentMessageStep(ctx, tx, orgID, campID, cand)
			if !ok {
				continue // passo atual não é entregável; candidato reservado
			}

			// GATE 3 — renderização: variável faltando para o contato PARA a
			// cadência dele (mesma regra do preview/piloto).
			result := s.renderer.Render(step.templateBody, templates.ContactData{
				FirstName: cand.FirstName,
				LastName:  cand.LastName,
				FullName:  cand.FullName,
				Company:   cand.Company,
				JobTitle:  cand.JobTitle,
			})
			if result.Error != nil || result.NeedsReview {
				if _, err := tx.Exec(ctx, `
					UPDATE campaign_contacts
					SET status = 'stopped', stopped_at = NOW(), stop_reason = 'missing_variables', updated_at = NOW()
					WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
				`, orgID, campID, cand.ContactID); err != nil {
					return err
				}
				continue
			}

			// Job idempotente (UNIQUE campaign|contact|step): duplicado = no-op.
			sum := sha256.Sum256([]byte(campID.String() + "|" + cand.ContactID.String() + "|" + step.id.String()))
			idemKey := hex.EncodeToString(sum[:])
			if _, err := tx.Exec(ctx, `
				INSERT INTO message_jobs
					(organization_id, campaign_id, contact_id, campaign_step_id, idempotency_key, rendered_content, status)
				VALUES ($1, $2, $3, $4, $5, $6, 'queued')
				ON CONFLICT DO NOTHING
			`, orgID, campID, cand.ContactID, step.id, idemKey, result.RenderedText); err != nil {
				return err
			}

			// Reserva o contato enquanto o job está em fila (não pega de novo).
			if _, err := tx.Exec(ctx, `
				UPDATE campaign_contacts
				SET status = 'waiting', current_step_id = $4, updated_at = NOW()
				WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
			`, orgID, campID, cand.ContactID, step.id); err != nil {
				return err
			}

			payload, _ := json.Marshal(map[string]any{
				"contact_name": cand.FullName,
				"company":      cand.Company,
				"campaign":     campName,
				"job_id":       idemKey,
			})
			if _, err := tx.Exec(ctx, `
				INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
				VALUES ($1, 'message', $2, 'message.queued', $3)
			`, orgID, cand.ContactID, payload); err != nil {
				return err
			}

			// Tempo real: o painel assina /events/stream e mostra a fila ao vivo.
			s.broker.Publish(orgID, "message.queued", map[string]any{
				"contact_name": cand.FullName,
				"company":      cand.Company,
				"campaign":     campName,
				"job_id":       idemKey,
			})

			telemetry.GlobalMetrics.JobsProcessed.Add(1)
			return nil // um despacho por org por tick
		}
		return nil
	})
}

// stepRef identifica o passo MESSAGE atual de um candidato.
type stepRef struct {
	id          uuid.UUID
	templateBody string
}

// pickOutreachCandidates devolve contatos pendentes da cadência cuja hora
// chegou (next_execution_at nulo/vencido), ordenados por entrada.
func (s *Server) pickOutreachCandidates(ctx context.Context, tx pgx.Tx, orgID, campID uuid.UUID) []outreachCandidate {
	rows, err := tx.Query(ctx, `
		SELECT cc.contact_id, cc.current_position,
		       c.first_name, c.last_name, c.full_name, c.company, c.job_title, c.linkedin_url
		FROM campaign_contacts cc
		JOIN contacts c ON c.id = cc.contact_id AND c.organization_id = $1
		WHERE cc.organization_id = $1 AND cc.campaign_id = $2
		  AND cc.status IN ('pending', 'waiting')
		  AND (cc.next_execution_at IS NULL OR cc.next_execution_at <= NOW())
		ORDER BY cc.created_at ASC
		LIMIT 10
	`, orgID, campID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]outreachCandidate, 0)
	for rows.Next() {
		var c outreachCandidate
		if err := rows.Scan(&c.ContactID, &c.Position, &c.FirstName, &c.LastName, &c.FullName, &c.Company, &c.JobTitle, &c.LinkedInURL); err != nil {
			continue
		}
		out = append(out, c)
	}
	_ = rows.Err()
	return out
}

// currentMessageStep devolve o passo MESSAGE na posição atual do candidato e
// faz o roteamento dos tipos não-entregáveis: sem passo na posição → cadência
// completa; passo não-MESSAGE → aplica o delay dele e avança a posição.
func (s *Server) currentMessageStep(ctx context.Context, tx pgx.Tx, orgID, campID uuid.UUID, cand outreachCandidate) (stepRef, bool) {
	var stepType string
	var step stepRef
	var delayAmount int
	var delayUnit string
	err := tx.QueryRow(ctx, `
		SELECT id, step_type, template_body, delay_amount, delay_unit
		FROM campaign_steps
		WHERE organization_id = $1 AND campaign_id = $2 AND position = $3
	`, orgID, campID, cand.Position).Scan(&step.id, &stepType, &step.templateBody, &delayAmount, &delayUnit)
	if errors.Is(err, pgx.ErrNoRows) {
		if cand.Position <= 1 {
			// Sem passo na posição inicial: a cadência está vazia (campanha
			// criada sem fluxo — ex.: "Fluxo em Branco" ainda não montado no
			// Flow Builder, ou criação via API). Completar aqui mentiria — o
			// contato nunca recebeu nada; fica pendente até haver cadência.
			return stepRef{}, false
		}
		// Já avançou pela cadência e não há mais passos: terminou de verdade.
		_, _ = tx.Exec(ctx, `
			UPDATE campaign_contacts
			SET status = 'completed', completed_at = NOW(), updated_at = NOW()
			WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
		`, orgID, campID, cand.ContactID)
		return stepRef{}, false
	}
	if err != nil {
		return stepRef{}, false
	}
	// Comparação case-insensitive: o builder da UI grava "MESSAGE", mas o
	// contrato da API aceita "message" — casar caixa fixa fazia o passo cair
	// no ramo não-entregável e a cadência completava sem enfileirar nada.
	if strings.EqualFold(stepType, "message") {
		// Job já em fila para esse passo? Aí o contato está reservado — não
		// pega de novo (evita duplicar despacho enquanto a extensão executa).
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM message_jobs
				WHERE organization_id = $1 AND campaign_id = $2
				  AND contact_id = $3 AND campaign_step_id = $4
				  AND status IN ('queued', 'sent')
			)
		`, orgID, campID, cand.ContactID, step.id).Scan(&exists); err != nil || exists {
			return stepRef{}, false
		}
		return step, true
	}

	// Passo não-MESSAGE (ex.: WAIT/CONNECT): aplica o delay e avança posição;
	// o contato volta a ser elegível no próximo tick.
	next := cand.Position + 1
	if _, err := tx.Exec(ctx, `
		UPDATE campaign_contacts
		SET current_position = $4, next_execution_at = NOW() + make_interval(
			years => 0, months => 0, days => CASE WHEN $5 = 'days' THEN $6 ELSE 0 END,
			weeks => 0, hours => CASE WHEN $5 = 'hours' THEN $6 ELSE 0 END,
			mins => CASE WHEN $5 = 'minutes' THEN $6 ELSE 0 END
		), updated_at = NOW()
		WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
	`, orgID, campID, cand.ContactID, next, delayUnit, delayAmount); err != nil {
		return stepRef{}, false
	}
	return stepRef{}, false
}

// withinExecutionWindow respeita allowed_start/end no timezone da campanha.
func withinExecutionWindow(start, end time.Time, tz string) bool {
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	s := time.Date(now.Year(), now.Month(), now.Day(), start.Hour(), start.Minute(), 0, 0, loc)
	e := time.Date(now.Year(), now.Month(), now.Day(), end.Hour(), end.Minute(), 59, 0, loc)
	if e.Before(s) { // janela atravessando a meia-noite
		return now.After(s) || now.Before(e)
	}
	return !now.Before(s) && !now.After(e)
}

func (s *Server) HandleListTemplates(w http.ResponseWriter, r *http.Request) {
	// Templates: mistura honesta de sistema (is_system_template, visíveis a
	// todos — sem organization_id) + os do próprio tenant (RLS). Token fixo
	// removido: o id do template de sistema é um UUID estável documentado.
	tpls := []map[string]any{
		{
			"id":                 "00000000-0000-0000-0000-000000000001",
			"name":               "VibexCorp Standard Outreach",
			"description":        "Fluxo padrão de 3 etapas com verificação de Stop on Reply.",
			"is_system_template": true,
		},
	}

	if orgID, _, ok := requireTenant(r); ok && s.pgClient != nil && s.pgClient.Pool != nil {
		_ = s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
			rows, err := tx.Query(r.Context(), `
				SELECT id, name, description, is_system_template
				FROM flow_templates
				ORDER BY created_at ASC
			`)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id uuid.UUID
				var name, desc string
				var isSys bool
				if err := rows.Scan(&id, &name, &desc, &isSys); err != nil {
					continue
				}
				tpls = append(tpls, map[string]any{
					"id":                 id,
					"name":               name,
					"description":        desc,
					"is_system_template": isSys,
				})
			}
			return rows.Err()
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"templates": tpls})
}

type PreviewRequest struct {
	TemplateBody string                `json:"template_body"`
	SampleData   templates.ContactData `json:"sample_data"`
}

func (s *Server) HandleTemplatePreview(w http.ResponseWriter, r *http.Request) {
	var req PreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	res := s.renderer.Render(req.TemplateBody, req.SampleData)
	writeJSON(w, http.StatusOK, map[string]any{
		"rendered_text": res.RenderedText,
		"needs_review":  res.NeedsReview,
		"missing_vars":  res.MissingVars,
	})
}

func (s *Server) HandleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
}

func (s *Server) HandleReady(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "database": "ok"})
}

// --- Apollo-Style Messaging, Outreach & Inbox Handlers ---

// NOTA Fase D: HandleDemoToken removido — era um emissor de JWT de owner sem
// credencial (qualquer POST ganhava token). A extensão usa pareamento por
// código + token_hash; o dashboard usa /auth/login com bcrypt.

func (s *Server) HandleGetPendingOutreach(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	// Trabalho REAL enfileirado pelo worker: um job 'queued' por vez, com a
	// fila restante e o saldo diário. Sem campanha/jobs → vazio honesto
	// (nunca camp-001 fictícia, nunca template cru com {{}}).
	type queuedJob struct {
		jobID, campaignID, campaignName string
		queueRemaining                  int
		contactID                       uuid.UUID
		first, last, full, comp, title  string
		url, rendered                   string
	}

	var job *queuedJob
	var dailyRemaining int

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT j.id, j.campaign_id, c.name, j.contact_id,
			       ct.first_name, ct.last_name, ct.full_name, ct.company, ct.job_title, ct.linkedin_url,
			       j.rendered_content
			FROM message_jobs j
			JOIN campaigns c ON c.id = j.campaign_id AND c.organization_id = $1 AND c.status = 'running'
			JOIN contacts ct ON ct.id = j.contact_id AND ct.organization_id = $1
			WHERE j.organization_id = $1 AND j.status = 'queued'
			ORDER BY j.created_at ASC
			LIMIT 1
		`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			j := &queuedJob{}
			if err := rows.Scan(&j.jobID, &j.campaignID, &j.campaignName, &j.contactID,
				&j.first, &j.last, &j.full, &j.comp, &j.title, &j.url, &j.rendered); err != nil {
				continue
			}
			job = j
		}
		if err := rows.Err(); err != nil {
			return err
		}

		// queueRemaining num local: com fila vazia, job é nil — dereferenciar
		// job.queueRemaining aqui causava panic (500 vazio) no caminho honesto
		// de "nenhum trabalho pendente".
		var queueRemaining int
		if err := tx.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM message_jobs
			WHERE organization_id = $1 AND status = 'queued'
		`, orgID).Scan(&queueRemaining); err != nil {
			return err
		}
		if job != nil {
			job.queueRemaining = queueRemaining
		}
		return nil
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	dailyRemaining = -1 // desconhecido sem Redis (worker segue com gates locais)
	if s.rateLimiter != nil {
		// O teto diário fica na campanha; para o payload o valor relativo ao
		// teto do servidor já dá a noção de saldo restante do dia.
		if rem, err := s.rateLimiter.RemainingToday(r.Context(), orgID, ratelimit.ServerMaxDailyLimit); err == nil {
			dailyRemaining = rem
		}
	}

	payload := map[string]any{
		"has_campaign":    job != nil,
		"campaign_id":     "",
		"campaign_name":   "",
		"queue_remaining": 0,
		"daily_remaining": dailyRemaining,
		"job":             nil,
	}
	if job != nil {
		payload["campaign_id"] = job.campaignID
		payload["campaign_name"] = job.campaignName
		payload["queue_remaining"] = job.queueRemaining
		payload["job"] = map[string]any{
			"job_id":           job.jobID,
			"contact_id":       job.contactID,
			"first_name":       job.first,
			"last_name":        job.last,
			"full_name":        job.full,
			"company":          job.comp,
			"job_title":        job.title,
			"linkedin_url":     job.url,
			"rendered_message": job.rendered,
		}
	}

	writeJSON(w, http.StatusOK, payload)
}

type ReportSentRequest struct {
	ContactID     string `json:"contact_id"`
	RecipientName string `json:"recipient_name"`
	MessageBody   string `json:"message_body"`
	LinkedInURL   string `json:"linkedin_url"`
	Status        string `json:"status"`
	JobID         string `json:"job_id"` // job enfileirado pelo worker (pipeline real)
	Error         string `json:"error"`  // não vazio = falha na entrega → retry
	// Auditoria do Jev + métricas de latência (a extensão envia; o painel exibe).
	AssistSource      string  `json:"assist_source"`
	AssistConfidence  float64 `json:"assist_confidence"`
	AssistPageState   string  `json:"assist_page_state"`
	JevMs             int64   `json:"jev_ms"`
	AssistTotalMs     int64   `json:"assist_total_ms"`
	AssistRoundtripMs int64   `json:"assist_roundtrip_ms"`
}

func (s *Server) HandleReportSentMessage(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var req ReportSentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}

	// Caminho do pipeline real: a extensão reporta contra o job enfileirado
	// pelo worker. Com erro → retry com backoff (attempts), 3 tentativas e a
	// cadência do contato para com motivo honesto.
	if req.JobID != "" {
		s.handleJobReportSent(w, r, orgID, req)
		return
	}

	if strings.TrimSpace(req.MessageBody) == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "message_body is required", nil)
		return
	}

	// Resolve o contato do próprio tenant por id ou linkedin_url; contato de
	// outro tenant não existe para este orgID (RLS) → 404 honesto.
	var contactID uuid.UUID
	byURL := req.ContactID == "" && req.LinkedInURL != ""
	if cid, err := uuid.Parse(req.ContactID); err == nil {
		contactID = cid
	}
	if byURL {
		if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
			err := tx.QueryRow(r.Context(), `
				SELECT id FROM contacts
				WHERE organization_id = $1 AND linkedin_url = $2
			`, orgID, req.LinkedInURL).Scan(&contactID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errContactNotFound
				}
				return err
			}
			return nil
		}) {
			if errors.Is(tenantTxErr, errContactNotFound) {
				writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
				return
			}
			return // 503 STORE_UNAVAILABLE já respondido pelo helper
		}
		if contactID == uuid.Nil {
			writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
			return
		}
	} else if contactID == uuid.Nil {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "contact_id or linkedin_url is required", nil)
		return
	}

	var (
		recipient, company string
		convID             uuid.UUID
	)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// 1. Contato pertence ao tenant? (UPDATE ... WHERE org+id; 0 linhas = 404)
		var fullName, comp string
		err := tx.QueryRow(r.Context(), `
			UPDATE contacts
			SET status = 'contacted', updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
			RETURNING full_name, company
		`, orgID, contactID).Scan(&fullName, &comp)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errContactNotFound
			}
			return err
		}
		recipient = req.RecipientName
		if recipient == "" {
			recipient = fullName
		}
		company = comp
		if company == "" {
			company = "LinkedIn"
		}

		// 2. Conversa do tenant para o contato (cria se não existir).
		err = tx.QueryRow(r.Context(), `
			SELECT id FROM conversations
			WHERE organization_id = $1 AND contact_id = $2
		`, orgID, contactID).Scan(&convID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if convID == uuid.Nil {
			err = tx.QueryRow(r.Context(), `
				INSERT INTO conversations (organization_id, contact_id, status)
				VALUES ($1, $2, 'open')
				RETURNING id
			`, orgID, contactID).Scan(&convID)
			if err != nil {
				return err
			}
		}

		// 3. Mensagem outbound + evento de auditoria, tudo na transação.
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO messages (organization_id, conversation_id, direction, content)
			VALUES ($1, $2, 'outbound', $3)
		`, orgID, convID, req.MessageBody); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{
			"contact_name":        recipient,
			"company":             company,
			"message_body":        req.MessageBody,
			"sent_via":            "extension",
			"assist_source":       req.AssistSource,
			"assist_confidence":   req.AssistConfidence,
			"assist_page_state":   req.AssistPageState,
			"jev_ms":              req.JevMs,
			"assist_total_ms":     req.AssistTotalMs,
			"assist_roundtrip_ms": req.AssistRoundtripMs,
		})
		_, err = tx.Exec(r.Context(), `
			INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
			VALUES ($1, 'message', $2, 'message.sent', $3)
		`, orgID, convID, payload)
		return err
	}) {
		if errors.Is(tenantTxErr, errContactNotFound) {
			writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	telemetry.GlobalMetrics.JobsProcessed.Add(1)

	activityItem := map[string]any{
		"id":          uuid.New().String(),
		"entity_type": "message",
		"entity_id":   convID,
		"event_type":  "message.sent",
		"description": fmt.Sprintf("Mensagem enviada via Extensão no LinkedIn para %s (%s)", recipient, company),
		"created_at":  time.Now(),
	}
	s.broker.Publish(orgID, "message.sent", activityItem)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "recorded",
		"message":    "sent message reported and recorded successfully",
		"contact_id": convID,
	})
}

// handleJobReportSent processa o relato da extensão sobre um job enfileirado
// pelo worker: sucesso confirma a entrega real (job 'sent', contato
// 'contacted', conversa + mensagem outbound, evento de auditoria) e avança a
// cadência com o delay do passo; falha incrementa attempts — 3 tentativas
// param a cadência do contato com stop_reason honesto.
func (s *Server) handleJobReportSent(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, req ReportSentRequest) {
	jobID, err := uuid.Parse(req.JobID)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "job_id is invalid", nil)
		return
	}

	type jobAdvance struct {
		campID, contactID, convID uuid.UUID
		position, delayAmount     int
		delayUnit                 string
		recipient, company        string
	}
	var adv jobAdvance
	failed := strings.TrimSpace(req.Error) != ""

	var outcome string
	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// 1. Job do tenant (RLS): job de outra org não existe → 404 honesto.
		var status string
		var attempts int
		if err := tx.QueryRow(r.Context(), `
			SELECT status, attempts, campaign_id, contact_id
			FROM message_jobs WHERE organization_id = $1 AND id = $2
		`, orgID, jobID).Scan(&status, &attempts, &adv.campID, &adv.contactID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errContactNotFound
			}
			return err
		}

		if failed {
			attempts++
			if attempts >= 3 {
				if _, err := tx.Exec(r.Context(), `
					UPDATE message_jobs
					SET status = 'failed', attempts = $3, error_type = 'delivery', error_message = $4, updated_at = NOW()
					WHERE organization_id = $1 AND id = $2
				`, orgID, jobID, attempts, truncateErrText(req.Error)); err != nil {
					return err
				}
				if _, err := tx.Exec(r.Context(), `
					UPDATE campaign_contacts
					SET status = 'stopped', stopped_at = NOW(), stop_reason = 'delivery_failed', updated_at = NOW()
					WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
				`, orgID, adv.campID, adv.contactID); err != nil {
					return err
				}
				s.recordEventTx(tx, orgID, adv.contactID, "message.failed", map[string]any{
					"job_id": req.JobID, "error": truncateErrText(req.Error), "final": true,
				})
				outcome = "failed_stopped"
				return nil
			}
			if _, err := tx.Exec(r.Context(), `
				UPDATE message_jobs
				SET attempts = $3, error_type = 'delivery', error_message = $4, updated_at = NOW()
				WHERE organization_id = $1 AND id = $2 AND status = 'queued'
			`, orgID, jobID, attempts, truncateErrText(req.Error)); err != nil {
				return err
			}
			s.recordEventTx(tx, orgID, adv.contactID, "message.failed", map[string]any{
				"job_id": req.JobID, "error": truncateErrText(req.Error), "attempts": attempts,
			})
			outcome = "retry_scheduled"
			return nil
		}

		// Idempotente: entrega já confirmada antes não duplica registro.
		if status == "sent" {
			outcome = "already_recorded"
			return nil
		}

		if _, err := tx.Exec(r.Context(), `
			UPDATE message_jobs
			SET status = 'sent', executed_at = NOW(), updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
		`, orgID, jobID); err != nil {
			return err
		}

		// 2. Contato do tenant vira 'contacted' (0 linhas = dado de outra org).
		var fullName, comp, rendered string
		if err := tx.QueryRow(r.Context(), `
			UPDATE contacts
			SET status = 'contacted', updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
			RETURNING full_name, company
		`, orgID, adv.contactID).Scan(&fullName, &comp); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errContactNotFound
			}
			return err
		}
		adv.recipient = req.RecipientName
		if adv.recipient == "" {
			adv.recipient = fullName
		}
		adv.company = comp
		if adv.company == "" {
			adv.company = "LinkedIn"
		}

		// 3. Conversa + mensagem outbound (mesma semântica do caminho manual).
		if err := tx.QueryRow(r.Context(), `
			SELECT id FROM conversations WHERE organization_id = $1 AND contact_id = $2
		`, orgID, adv.contactID).Scan(&adv.convID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if adv.convID == uuid.Nil {
			if err := tx.QueryRow(r.Context(), `
				INSERT INTO conversations (organization_id, contact_id, status)
				VALUES ($1, $2, 'open')
				RETURNING id
			`, orgID, adv.contactID).Scan(&adv.convID); err != nil {
				return err
			}
		}
		if err := tx.QueryRow(r.Context(), `
			SELECT rendered_content FROM message_jobs WHERE organization_id = $1 AND id = $2
		`, orgID, jobID).Scan(&rendered); err != nil {
			return err
		}
		if req.MessageBody != "" {
			rendered = req.MessageBody
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO messages (organization_id, conversation_id, direction, content)
			VALUES ($1, $2, 'outbound', $3)
		`, orgID, adv.convID, rendered); err != nil {
			return err
		}
		s.recordEventTx(tx, orgID, adv.convID, "message.sent", map[string]any{
			"contact_name":        adv.recipient,
			"company":             adv.company,
			"job_id":              req.JobID,
			"sent_via":            "extension",
			"assist_source":       req.AssistSource,
			"assist_confidence":   req.AssistConfidence,
			"assist_page_state":   req.AssistPageState,
			"jev_ms":              req.JevMs,
			"assist_total_ms":     req.AssistTotalMs,
			"assist_roundtrip_ms": req.AssistRoundtripMs,
		})

		// 4. Avança a cadência: próximo passo com o delay do passo atual,
		// ou cadência completa se este era o último.
		if err := tx.QueryRow(r.Context(), `
			SELECT cc.current_position, COALESCE(cs.delay_amount, 0), COALESCE(cs.delay_unit, 'days')
			FROM campaign_contacts cc
			LEFT JOIN campaign_steps cs ON cs.campaign_id = cc.campaign_id AND cs.position = cc.current_position
			WHERE cc.organization_id = $1 AND cc.campaign_id = $2 AND cc.contact_id = $3
		`, orgID, adv.campID, adv.contactID).Scan(&adv.position, &adv.delayAmount, &adv.delayUnit); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		var nextStepID uuid.UUID
		err := tx.QueryRow(r.Context(), `
			SELECT id FROM campaign_steps
			WHERE organization_id = $1 AND campaign_id = $2 AND position = $3
		`, orgID, adv.campID, adv.position+1).Scan(&nextStepID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(r.Context(), `
				UPDATE campaign_contacts
				SET status = 'completed', completed_at = NOW(), current_step_id = NULL, next_execution_at = NULL, updated_at = NOW()
				WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
			`, orgID, adv.campID, adv.contactID)
			return err
		}
		_, err = tx.Exec(r.Context(), `
			UPDATE campaign_contacts
			SET status = 'waiting', current_position = $4, current_step_id = $5, next_execution_at = NOW() + make_interval(
				years => 0, months => 0, days => CASE WHEN $6 = 'days' THEN $7 ELSE 0 END,
				weeks => 0, hours => CASE WHEN $6 = 'hours' THEN $7 ELSE 0 END,
				mins => CASE WHEN $6 = 'minutes' THEN $7 ELSE 0 END
			), updated_at = NOW()
			WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
		`, orgID, adv.campID, adv.contactID, adv.position+1, nextStepID, adv.delayUnit, adv.delayAmount)
		return err
	}) {
		if errors.Is(tenantTxErr, errContactNotFound) {
			writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact or job not found", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	switch outcome {
	case "retry_scheduled", "failed_stopped":
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  outcome,
			"job_id":  req.JobID,
			"message": "delivery failure recorded; cadence updated accordingly",
		})
		return
	}

	if outcome != "already_recorded" {
		if s.rateLimiter != nil {
			_ = s.rateLimiter.RecordExecution(r.Context(), orgID)
		}
		telemetry.GlobalMetrics.JobsProcessed.Add(1)
		s.broker.Publish(orgID, "message.sent", map[string]any{
			"id":          uuid.New().String(),
			"entity_type": "message",
			"entity_id":   adv.convID,
			"event_type":  "message.sent",
			"description": fmt.Sprintf("Mensagem enviada via Extensão no LinkedIn para %s (%s)", adv.recipient, adv.company),
			"created_at":  time.Now(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "recorded",
		"message":    "sent message reported and recorded successfully",
		"job_id":     req.JobID,
		"contact_id": adv.convID,
	})
}

// recordEventTx grava evento de auditoria dentro da transação com tenant.
func (s *Server) recordEventTx(tx pgx.Tx, orgID, entityID uuid.UUID, eventType string, fields map[string]any) {
	payload, _ := json.Marshal(fields)
	_, _ = tx.Exec(context.Background(), `
		INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
		VALUES ($1, 'message', $2, $3, $4)
	`, orgID, entityID, eventType, payload)
}

func truncateErrText(s string) string {
	if len(s) > 500 {
		return s[:500]
	}
	return s
}

type ReportReplyRequest struct {
	ContactID     string `json:"contact_id"`
	RecipientName string `json:"recipient_name"`
	ReplyBody     string `json:"reply_body"`
}

func (s *Server) HandleReportReply(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var req ReportReplyRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.ReplyBody) == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "reply_body is required", nil)
		return
	}

	// Resolve o contato do próprio tenant por id ou nome; contato de outro
	// tenant não existe para este orgID (RLS) → 404 honesto.
	var contactID uuid.UUID
	if cid, err := uuid.Parse(req.ContactID); err == nil {
		contactID = cid
	}
	if contactID == uuid.Nil && req.RecipientName != "" {
		if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
			err := tx.QueryRow(r.Context(), `
				SELECT id FROM contacts
				WHERE organization_id = $1 AND full_name = $2
				ORDER BY updated_at DESC
				LIMIT 1
			`, orgID, req.RecipientName).Scan(&contactID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errContactNotFound
				}
				return err
			}
			return nil
		}) {
			if errors.Is(tenantTxErr, errContactNotFound) {
				writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
				return
			}
			return // 503 STORE_UNAVAILABLE já respondido pelo helper
		}
	}
	if contactID == uuid.Nil {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "contact_id or recipient_name is required", nil)
		return
	}

	var recipient string

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		// 1. Marca replied + Stop on Reply: contato do tenant vira replied e
		// os follow-ups pendentes da cadência são cancelados na transação.
		var fullName string
		err := tx.QueryRow(r.Context(), `
			UPDATE contacts
			SET status = 'replied', updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
			RETURNING full_name
		`, orgID, contactID).Scan(&fullName)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errContactNotFound
			}
			return err
		}
		recipient = fullName

		if _, err := tx.Exec(r.Context(), `
			UPDATE campaign_contacts
			SET status = 'stopped', stop_reason = 'stop_on_reply', stopped_at = NOW(), updated_at = NOW()
			WHERE organization_id = $1 AND contact_id = $2
			  AND status IN ('pending', 'waiting', 'active')
		`, orgID, contactID); err != nil {
			return err
		}

		// 2. Conversa do tenant: marca replied e grava a inbound.
		var convID uuid.UUID
		err = tx.QueryRow(r.Context(), `
			SELECT id FROM conversations
			WHERE organization_id = $1 AND contact_id = $2
		`, orgID, contactID).Scan(&convID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if convID == uuid.Nil {
			err = tx.QueryRow(r.Context(), `
				INSERT INTO conversations (organization_id, contact_id, status)
				VALUES ($1, $2, 'replied')
				RETURNING id
			`, orgID, contactID).Scan(&convID)
			if err != nil {
				return err
			}
		} else if _, err := tx.Exec(r.Context(), `
			UPDATE conversations SET status = 'replied', updated_at = NOW()
			WHERE organization_id = $1 AND id = $2
		`, orgID, convID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO messages (organization_id, conversation_id, direction, content)
			VALUES ($1, $2, 'inbound', $3)
		`, orgID, convID, req.ReplyBody); err != nil {
			return err
		}

		// 3. Evento de auditoria reply.detected na mesma transação.
		payload, _ := json.Marshal(map[string]any{
			"recipient_name": recipient,
			"reply_body":     req.ReplyBody,
		})
		_, err = tx.Exec(r.Context(), `
			INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
			VALUES ($1, 'message', $2, 'reply.detected', $3)
		`, orgID, convID, payload)
		return err
	}) {
		if errors.Is(tenantTxErr, errContactNotFound) {
			writeAPIError(w, http.StatusNotFound, "CONTACT_NOT_FOUND", "contact not found", nil)
			return
		}
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	activityItem := map[string]any{
		"id":          uuid.New().String(),
		"entity_type": "message",
		"entity_id":   contactID,
		"event_type":  "reply.detected",
		"description": fmt.Sprintf("Resposta detectada no LinkedIn de %s — Follow-ups cancelados (Stop on Reply)", recipient),
		"created_at":  time.Now(),
	}

	s.broker.Publish(orgID, "reply.detected", activityItem)
	writeJSON(w, http.StatusOK, map[string]any{"status": "reply_recorded", "stop_on_reply": true})
}

func (s *Server) HandleListConversations(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	// Conversas do próprio tenant com última mensagem (RLS); sem conversa =
	// lista vazia honesta, nunca dado de outro tenant.
	type convRow struct {
		id, contactID, status  string
		leadName, company      string
		jobTitle, linkedinURL string
		lastMsg, lastTime      string
		hasReplied             bool
	}
	rows := make([]convRow, 0)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		qrows, err := tx.Query(r.Context(), `
			SELECT conv.id, conv.contact_id, conv.status,
			       c.full_name, COALESCE(c.company, ''), COALESCE(c.job_title, ''),
			       COALESCE(c.linkedin_url, ''),
			       COALESCE((SELECT m.content FROM messages m
			                 WHERE m.organization_id = $1 AND m.conversation_id = conv.id
			                 ORDER BY m.sent_at DESC LIMIT 1), ''),
			       COALESCE((SELECT TO_CHAR(m.sent_at, 'HH24:MI') FROM messages m
			                 WHERE m.organization_id = $1 AND m.conversation_id = conv.id
			                 ORDER BY m.sent_at DESC LIMIT 1), ''),
			       EXISTS(SELECT 1 FROM messages m
			              WHERE m.organization_id = $1 AND m.conversation_id = conv.id
			              AND m.direction = 'inbound')
			FROM conversations conv
			JOIN contacts c ON c.id = conv.contact_id AND c.organization_id = $1
			WHERE conv.organization_id = $1
			ORDER BY conv.updated_at DESC
			LIMIT 200
		`, orgID)
		if err != nil {
			return err
		}
		defer qrows.Close()
		for qrows.Next() {
			var row convRow
			var cid, coid uuid.UUID
			if err := qrows.Scan(&cid, &coid, &row.status, &row.leadName,
				&row.company, &row.jobTitle, &row.linkedinURL,
				&row.lastMsg, &row.lastTime, &row.hasReplied); err != nil {
				continue
			}
			row.id, row.contactID = cid.String(), coid.String()
			rows = append(rows, row)
		}
		return qrows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	list := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		status := row.status
		if status != "replied" && status != "archived" {
			status = "open"
		}
		list = append(list, map[string]any{
			"id":              row.id,
			"contact_id":      row.contactID,
			"leadName":        row.leadName,
			"company":         row.company,
			"jobTitle":        row.jobTitle,
			"linkedinUrl":     row.linkedinURL,
			"lastMessage":     row.lastMsg,
			"lastMessageTime": row.lastTime,
			"status":          status,
			"hasReplied":      row.hasReplied,
			"messages":        []map[string]any{},
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"conversations": list, "total": len(list)})
}

func (s *Server) HandleGetConversation(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}
	convUUID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_CONVERSATION_ID", "invalid conversation id", nil)
		return
	}

	// Conversa + mensagens do próprio tenant (RLS); de outro tenant ou
	// inexistente = 404 honesto, nunca vaza conteúdo alheio.
	var (
		contactID, status, leadName, company, jobTitle, linkedinURL string
		lastMsg, lastTime                                            string
		hasReplied                                                   bool
		found                                                        bool
	)
	msgs := make([]map[string]any, 0)

	if !s.withTenantDB(w, r, orgID, func(tx pgx.Tx) error {
		var cid, coid uuid.UUID
		err := tx.QueryRow(r.Context(), `
			SELECT conv.id, conv.contact_id, conv.status,
			       c.full_name, COALESCE(c.company, ''), COALESCE(c.job_title, ''),
			       COALESCE(c.linkedin_url, '')
			FROM conversations conv
			JOIN contacts c ON c.id = conv.contact_id AND c.organization_id = $1
			WHERE conv.organization_id = $1 AND conv.id = $2
		`, orgID, convUUID).Scan(&cid, &coid, &status, &leadName, &company, &jobTitle, &linkedinURL)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		contactID = coid.String()
		found = true

		mrows, err := tx.Query(r.Context(), `
			SELECT id, direction, content, TO_CHAR(sent_at, 'HH24:MI')
			FROM messages
			WHERE organization_id = $1 AND conversation_id = $2
			ORDER BY sent_at ASC
		`, orgID, cid)
		if err != nil {
			return err
		}
		defer mrows.Close()
		for mrows.Next() {
			var mid uuid.UUID
			var dir, content, sentAt string
			if err := mrows.Scan(&mid, &dir, &content, &sentAt); err != nil {
				continue
			}
			if dir == "inbound" {
				hasReplied = true
			}
			if content != "" {
				lastMsg, lastTime = content, sentAt
			}
			msgs = append(msgs, map[string]any{
				"id":        mid.String(),
				"direction": dir,
				"content":   content,
				"sentAt":    sentAt,
			})
		}
		return mrows.Err()
	}) {
		return // 503 STORE_UNAVAILABLE já respondido pelo helper
	}

	if !found {
		writeAPIError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "conversation not found", nil)
		return
	}
	if status != "replied" && status != "archived" {
		status = "open"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":              convUUID.String(),
		"contact_id":      contactID,
		"leadName":        leadName,
		"company":         company,
		"jobTitle":        jobTitle,
		"linkedinUrl":     linkedinURL,
		"lastMessage":     lastMsg,
		"lastMessageTime": lastTime,
		"status":          status,
		"hasReplied":      hasReplied,
		"messages":        msgs,
	})
}

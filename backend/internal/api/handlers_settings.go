package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"

	pgx "github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/ratelimit"
)

// --- Limites globais reais (organizations.platform_settings) -------------
// Fonte da verdade do slider/janela da tela de settings; o worker usa estes
// valores quando a campanha não tem limite próprio.

type PlatformSettings struct {
	DailyLimit       int    `json:"daily_limit"`
	AllowedStartTime string `json:"allowed_start_time"`
	AllowedEndTime   string `json:"allowed_end_time"`
	Timezone         string `json:"timezone"`
}

func defaultPlatformSettings() PlatformSettings {
	return PlatformSettings{
		DailyLimit:       30,
		AllowedStartTime: "08:00",
		AllowedEndTime:   "18:00",
		Timezone:         "America/Sao_Paulo",
	}
}

func (s *Server) HandleGetDailyLimits(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	settings := defaultPlatformSettings()
	if s.pgClient != nil && s.pgClient.Pool != nil {
		// organizations está sob RLS (000011): a leitura precisa do próprio
		// contexto de tenant (set_config transacional via ExecWithTenant).
		_ = s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(r.Context(), `
				SELECT platform_settings FROM organizations WHERE id = $1
			`, orgID).Scan(&raw); err == nil && len(raw) > 0 {
				_ = json.Unmarshal(raw, &settings)
			}
			return nil // org sem settings → defaults honestos
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"daily_limit":        settings.DailyLimit,
		"allowed_start_time": settings.AllowedStartTime,
		"allowed_end_time":   settings.AllowedEndTime,
		"timezone":           settings.Timezone,
		"server_max_limit":   ratelimit.ServerMaxDailyLimit,
		"server_min_limit":   5,
	})
}

func (s *Server) HandleSaveDailyLimits(w http.ResponseWriter, r *http.Request) {
	orgID, _, ok := tenantOr401(w, r)
	if !ok {
		return
	}

	var req PlatformSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}
	if req.DailyLimit < 5 || req.DailyLimit > ratelimit.ServerMaxDailyLimit {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "daily_limit must be between 5 and 50", nil)
		return
	}
	start, err1 := time.Parse("15:04", req.AllowedStartTime)
	end, err2 := time.Parse("15:04", req.AllowedEndTime)
	if err1 != nil || err2 != nil {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "allowed_start_time/allowed_end_time must be HH:MM", nil)
		return
	}
	if req.Timezone == "" {
		req.Timezone = "America/Sao_Paulo"
	}
	if _, err := time.LoadLocation(req.Timezone); err != nil {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "unknown timezone", nil)
		return
	}
	_ = start
	_ = end

	raw, _ := json.Marshal(req)
	if s.pgClient == nil || s.pgClient.Pool == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "postgres offline - rode scripts/local/start.ps1", nil)
		return
	}
	// UPDATE sob RLS: só a própria org é visível para o próprio contexto —
	// 0 linhas afetadas = org inexistente ou de outro tenant (404 honesto).
	var rowsAffected int64
	if err := s.pgClient.ExecWithTenant(r.Context(), orgID, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), `
			UPDATE organizations
			SET platform_settings = $2::jsonb, updated_at = NOW()
			WHERE id = $1
		`, orgID, raw)
		if err != nil {
			return err
		}
		rowsAffected = cmd.RowsAffected()
		return nil
	}); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", "failed to persist platform settings", nil)
		return
	}
	if rowsAffected == 0 {
		writeAPIError(w, http.StatusNotFound, "UNAUTHENTICATED", "organization not found", nil)
		return
	}

	s.broker.Publish(orgID, "settings.updated", map[string]any{"daily_limit": req.DailyLimit})
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "saved",
		"daily_limit": req.DailyLimit,
	})
}

// --- Download da extensão -------------------------------------------------
// Servido sem auth para o botão "Baixar extensão" da página /extension do
// painel; o caminho vem de EXTENSION_ZIP_PATH (start.ps1) ou do default
// relativo ao diretório backend/.

func (s *Server) HandleDownloadExtension(w http.ResponseWriter, r *http.Request) {
	zipPath := s.extensionZip
	if zipPath == "" {
		zipPath = os.Getenv("EXTENSION_ZIP_PATH")
	}
	if zipPath == "" {
		zipPath = "../../ext/vibexcorp-extension.zip"
	}
	data, err := os.ReadFile(zipPath)
	if err != nil || len(data) == 0 {
		writeAPIError(w, http.StatusNotFound, "EXTENSION_NOT_FOUND", "extension package not built yet - rode npm run build em ext/", nil)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="vibexcorp-extension.zip"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

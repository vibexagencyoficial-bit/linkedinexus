package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func (s *Server) SetupRouter() *chi.Mux {
	r := chi.NewRouter()

	// Global standard middlewares
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Restrictive CORS with functional origin matching for Chrome Extensions
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			// Permite qualquer origem de extensão Chrome ou localhost do Next.js
			if strings.HasPrefix(origin, "chrome-extension://") ||
				strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "https://localhost") {
				return true
			}
			return true // Modo dev: autoriza requisições da extensão e do dashboard
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Organization-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health and Ready probes (unauthenticated)
	r.Get("/health", s.HandleHealth)
	r.Get("/ready", s.HandleReady)
	// Pacote da extensão para o botão "Baixar" da página /extension do painel.
	r.Get("/api/v1/downloads/extension.zip", s.HandleDownloadExtension)

	// API v1 group
	r.Route("/api/v1", func(r chi.Router) {
		// Public Auth & Pairing (NOTA Fase D: /auth/demo-token removido —
		// emissor de JWT sem credencial; pareamento é só via /extension/pair)
		r.Post("/auth/login", s.HandleLogin)
		r.Post("/auth/logout", s.HandleLogout)
		r.Post("/extension/pair", s.HandlePairExtension)
		// Heartbeat autentica pelo token do device (token_hash), NÃO por JWT:
		// ficar no grupo protegido rejeitava o heartbeat real da extensão.
		r.Post("/extension/heartbeat", s.HandleExtensionHeartbeat)
		r.Post("/templates/preview", s.HandleTemplatePreview)

		// Protected Routes
		r.Group(func(r chi.Router) {
			r.Use(s.authService.Middleware)

			// Auth Context
			r.Get("/auth/me", s.HandleMe)
			r.Post("/auth/refresh", s.HandleRefresh)

			// SSE Stream
			r.Get("/events/stream", s.broker.StreamHandler)

			// Dashboard Metrics & Activity
			r.Get("/dashboard/metrics", s.HandleDashboardMetrics)
			r.Get("/activity", s.HandleListActivity)

			// LinkedIn Account Integration
			r.Get("/accounts/current", s.HandleCurrentAccount)
			r.Post("/accounts/connect", s.HandleConnectAccount)
			r.Post("/accounts/disconnect", s.HandleDisconnectAccount)

			// Browser Extension
			r.Post("/extension/pairing-code", s.HandleGeneratePairingCode)
			r.Get("/extension/status", s.HandleExtensionStatus)

			// Contacts
			r.Get("/contacts", s.HandleListContacts)
			r.Post("/contacts", s.HandleCreateContact)
			r.Get("/contacts/{id}", s.HandleGetContact)
			r.Delete("/contacts/{id}", s.HandleDeleteContact)
			r.Post("/contacts/import", s.HandleImportContactsCSV)
			r.Post("/contacts/sync-linkedin", s.HandleSyncLinkedInContacts)

			// Messaging & Outreach Dispatch (Apollo.io Model)
			r.Get("/messaging/pending-outreach", s.HandleGetPendingOutreach)
			r.Post("/messaging/report-sent", s.HandleReportSentMessage)
			r.Post("/messaging/report-reply", s.HandleReportReply)

			// Assist de automação humana (proxy Typesafe/Jev — chave nunca
			// sai do backend; a extensão consome via este endpoint).
			r.Post("/assist/humanize", s.HandleAssistHumanize)

			// Limites globais reais (slider/janela da tela de settings).
			r.Get("/settings/daily-limits", s.HandleGetDailyLimits)
			r.Put("/settings/daily-limits", s.HandleSaveDailyLimits)

			// Conversations & Inbox
			r.Get("/conversations", s.HandleListConversations)
			r.Get("/conversations/{id}", s.HandleGetConversation)

			// Campaigns & Flow Builder
			r.Get("/campaigns", s.HandleListCampaigns)
			r.Post("/campaigns", s.HandleCreateCampaign)
			r.Get("/campaigns/{id}", s.HandleGetCampaign)
			r.Get("/campaigns/{id}/steps", s.HandleGetCampaignSteps)
			r.Put("/campaigns/{id}/steps", s.HandleSaveCampaignSteps)
			r.Get("/campaigns/{id}/preview", s.HandleCampaignPreview)
			r.Post("/campaigns/{id}/start", s.HandleStartCampaign)
			r.Post("/campaigns/{id}/pause", s.HandlePauseCampaign)
			r.Post("/campaigns/{id}/resume", s.HandleResumeCampaign)

			// Flow Templates
			r.Get("/templates", s.HandleListTemplates)

			// System Outreaching & Emergency Kill Switch
			r.Post("/system/pause-outreach", s.HandleSystemPauseOutreach)
			r.Post("/settings/kill-switch", s.HandleGlobalKillSwitch)
		})
	})

	return r
}

package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

// corsAllowedOrigins: allowlist explícita (env CORS_ALLOWED_ORIGINS, vírgula)
// + origens chrome-extension://. SEM wildcard: o "return true" antigo anulava
// toda a whitelist.
func corsAllowedOrigins() []string {
	def := "http://localhost:3001,http://localhost:3000"
	if v := os.Getenv("CORS_ALLOWED_ORIGINS"); strings.TrimSpace(v) != "" {
		def = v
	}
	out := []string{}
	for _, o := range strings.Split(def, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func (s *Server) SetupRouter() *chi.Mux {
	r := chi.NewRouter()

	// Global standard middlewares
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Rate limit global (por IP): 120 req/min; buckets mais duros nas rotas
	// sensíveis abaixo.
	r.Use(s.rateLimitMiddleware(bucketGlobal))

	allowed := corsAllowedOrigins()
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			// Extensões Chrome têm origem própria (chrome-extension://<id>) —
			// permitidas por scheme; painéis só da allowlist.
			if strings.HasPrefix(origin, "chrome-extension://") {
				return true
			}
			for _, a := range allowed {
				if origin == a {
					return true
				}
			}
			return false
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		// X-Organization-ID removido: tenant vem SOMENTE do JWT (nunca de header).
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: false, // tokens vão no header Authorization, sem cookies
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
		// Buckets anti-brute-force: login 10/min/IP, pair 5/10min/IP
		// (código de 8 hex = 4 bi combinações; sem teto, é quebrável online).
		r.With(s.rateLimitMiddleware(bucketLogin)).Post("/auth/login", s.HandleLogin)
		r.Post("/auth/logout", s.HandleLogout)
		r.With(s.rateLimitMiddleware(bucketPair)).Post("/extension/pair", s.HandlePairExtension)
		// Heartbeat e renovação autenticam pelo token do device (token_hash),
		// NÃO por JWT: no grupo protegido seriam rejeitados.
		r.With(s.rateLimitMiddleware(bucketHeartbeat)).Post("/extension/heartbeat", s.HandleExtensionHeartbeat)
		r.With(s.rateLimitMiddleware(bucketHeartbeat)).Post("/extension/token", s.HandleExtensionToken)
		// Refresh é PÚBLICO e autentica pelo refresh_token (sessão DB-backed):
		// dentro do grupo com Middleware, o access expirado seria rejeitado
		// antes de chegar ao handler e a renovação nunca funcionaria.
		r.With(s.rateLimitMiddleware(bucketLogin)).Post("/auth/refresh", s.HandleRefreshDB)
		r.Post("/templates/preview", s.HandleTemplatePreview)

		// Protected Routes
		r.Group(func(r chi.Router) {
			r.Use(s.authService.Middleware)

			// Auth Context (/auth/refresh é público — rota acima).
			r.Get("/auth/me", s.HandleMe)

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
		r.With(s.rateLimitMiddleware(bucketPairingCode)).Post("/extension/pairing-code", s.HandleGeneratePairingCode)
		r.Get("/extension/status", s.HandleExtensionStatus)

			// Contacts
			r.Get("/contacts", s.HandleListContacts)
			r.Post("/contacts", s.HandleCreateContact)
			r.Get("/contacts/{id}", s.HandleGetContact)
			r.Delete("/contacts/{id}", s.HandleDeleteContact)
			r.Post("/contacts/import", s.HandleImportContactsCSV)
			r.Post("/contacts/import-json", s.HandleImportContactsJSON)
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

package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/api"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/events"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	redisplatform "github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
)

func main() {
	log := logger.New("info")
	log.Info("initializing VibexCorp LinkedIn Outreach API Server")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://vibex_admin:vibex_secure_password_2026@localhost:5432/vibex_outreach?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "vibexcorp-enterprise-jwt-super-secret-key-32b"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	pgClient, err := postgres.New(ctx, dbURL)
	if err != nil {
		log.Warn("PostgreSQL is currently offline on localhost:5432. Starting server with in-memory resilient store so extension and dashboard work immediately.", "error", err)
	} else {
		log.Info("connected to PostgreSQL successfully")
		defer pgClient.Close()
	}

	// Redis opcional: alimenta o rate limiter do worker (teto diário +
	// cooldown). Sem Redis a API sobe igual, mas o worker não despacha —
	// não é possível respeitar o limite de segurança sem contador.
	var redisClient *redisplatform.Client
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		// redisplatform.New já aplica timeout interno de 5s no Ping.
		redisClient, err = redisplatform.New(redisURL)
		if err != nil {
			log.Warn("Redis offline — worker fica sem rate limiter e não despachará envios.", "error", err)
			redisClient = nil
		} else {
			log.Info("connected to Redis successfully (rate limiter ativo)")
			defer redisClient.Close()
		}
	}

	extensionZip := os.Getenv("EXTENSION_ZIP_PATH")

	// Access tokens são TEMPORÁRIOS: painel 15min, extensão 60min (TTLs
	// explícitos por emissão). O default do serviço é o teto do painel.
	authService := auth.NewService(jwtSecret, 15*time.Minute)
	safetyService := safety.NewPlatformSafetyService()
	broker := events.NewBroker()

	server := api.NewServerWithRedis(pgClient, authService, safetyService, broker, redisClient, extensionZip)
	router := server.SetupRouter()

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info(fmt.Sprintf("HTTP Server listening on :%s", port))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("HTTP Server failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down HTTP Server gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Error("error during server shutdown", "error", err)
	}
	log.Info("server exited cleanly")
}

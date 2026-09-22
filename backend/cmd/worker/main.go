package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/messaging"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/queue"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/ratelimit"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
)

func main() {
	log := logger.New("info")
	log.Info("initializing VibexCorp LinkedIn Outreach Worker")

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://vibex_admin:vibex_secure_password_2026@localhost:5432/vibex_outreach?sslmode=disable"
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://:vibex_redis_pass_2026@localhost:6379/0"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pgClient, err := postgres.New(ctx, dbURL)
	if err != nil {
		log.Error("failed to connect to postgresql", "error", err)
		os.Exit(1)
	}
	defer pgClient.Close()

	redisClient, err := redis.New(redisURL)
	if err != nil {
		log.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	safetyService := safety.NewPlatformSafetyService()
	rateLimiter := ratelimit.NewRateLimiter(redisClient)
	executor := messaging.NewExecutor(pgClient, safetyService, rateLimiter)
	workerHandler := queue.NewWorkerHandler(executor)

	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		log.Error("failed to parse asynq redis uri", "error", err)
		os.Exit(1)
	}

	srv := asynq.NewServer(
		redisOpt,
		asynq.Config{
			Concurrency: 10,
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
		},
	)

	mux := asynq.NewServeMux()
	mux.HandleFunc(queue.TypeCampaignStepExecute, workerHandler.ProcessTask)

	go func() {
		if err := srv.Run(mux); err != nil {
			log.Error("asynq worker server failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down Asynq Worker gracefully...")
	srv.Shutdown()
	log.Info("worker exited cleanly")
}

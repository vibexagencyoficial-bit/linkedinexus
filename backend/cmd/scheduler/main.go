package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/scheduler"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
)

func main() {
	log := logger.New("info")
	log.Info("initializing VibexCorp LinkedIn Outreach Scheduler")

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

	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		log.Error("failed to parse asynq redis uri", "error", err)
		os.Exit(1)
	}
	asynqClient := asynq.NewClient(redisOpt)
	defer asynqClient.Close()

	schedService := scheduler.NewService(pgClient, redisClient, asynqClient, 5*time.Second)

	schedCtx, schedCancel := context.WithCancel(context.Background())
	defer schedCancel()

	go schedService.Start(schedCtx)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down Scheduler gracefully...")
	schedCancel()
	schedService.Stop()
	log.Info("scheduler exited cleanly")
}

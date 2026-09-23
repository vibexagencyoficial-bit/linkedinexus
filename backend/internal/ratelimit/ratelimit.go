package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
)

const (
	// Server policies (ceiling limits)
	ServerMaxDailyLimit     = 50
	ServerMinActionInterval = 90 * time.Second
)

type RateLimiter struct {
	redisClient *redis.Client
}

func NewRateLimiter(rdb *redis.Client) *RateLimiter {
	return &RateLimiter{
		redisClient: rdb,
	}
}

// EffectiveDailyLimit enforces MIN(user_configuration, server_policy)
func EffectiveDailyLimit(userLimit int) int {
	if userLimit <= 0 {
		return 20
	}
	if userLimit > ServerMaxDailyLimit {
		return ServerMaxDailyLimit
	}
	return userLimit
}

// CanExecuteAccount checks whether an account is within daily limit and minimum interval
func (rl *RateLimiter) CanExecuteAccount(ctx context.Context, accountID uuid.UUID, userDailyLimit int) (bool, string, error) {
	effectiveLimit := EffectiveDailyLimit(userDailyLimit)
	today := time.Now().Format("2006-01-02")
	counterKey := fmt.Sprintf("rate:%s:daily:%s", accountID.String(), today)
	intervalKey := fmt.Sprintf("rate:%s:cooldown", accountID.String())

	// 1. Check minimum interval between actions
	inCooldown, err := rl.redisClient.Rdb.Exists(ctx, intervalKey).Result()
	if err != nil {
		return false, "", err
	}
	if inCooldown > 0 {
		return false, "account is in mandatory safety interval cooldown", nil
	}

	// 2. Check daily volume
	currentCount, err := rl.redisClient.Rdb.Get(ctx, counterKey).Int()
	if err != nil && err.Error() != "redis: nil" {
		return false, "", err
	}

	if currentCount >= effectiveLimit {
		return false, fmt.Sprintf("daily execution limit reached (%d/%d)", currentCount, effectiveLimit), nil
	}

	return true, "", nil
}

// RecordExecution increments the daily count and sets the safety interval cooldown
func (rl *RateLimiter) RecordExecution(ctx context.Context, accountID uuid.UUID) error {
	today := time.Now().Format("2006-01-02")
	counterKey := fmt.Sprintf("rate:%s:daily:%s", accountID.String(), today)
	intervalKey := fmt.Sprintf("rate:%s:cooldown", accountID.String())

	pipe := rl.redisClient.Rdb.Pipeline()
	pipe.Incr(ctx, counterKey)
	pipe.Expire(ctx, counterKey, 48*time.Hour)
	pipe.Set(ctx, intervalKey, "1", ServerMinActionInterval)
	_, err := pipe.Exec(ctx)
	return err
}

// RemainingToday devolve o saldo diário restante da conta (teto efetivo -
// executados hoje). Erro de Redis é propagado para o chamador decidir.
func (rl *RateLimiter) RemainingToday(ctx context.Context, accountID uuid.UUID, userDailyLimit int) (int, error) {
	effectiveLimit := EffectiveDailyLimit(userDailyLimit)
	today := time.Now().Format("2006-01-02")
	counterKey := fmt.Sprintf("rate:%s:daily:%s", accountID.String(), today)

	currentCount, err := rl.redisClient.Rdb.Get(ctx, counterKey).Int()
	if err != nil && err.Error() != "redis: nil" {
		return 0, err
	}
	remaining := effectiveLimit - currentCount
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
}

package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Client struct {
	Rdb *redis.Client
}

func New(redisURL string) (*Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis url: %w", err)
	}

	rdb := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return &Client{Rdb: rdb}, nil
}

func (c *Client) Close() error {
	return c.Rdb.Close()
}

// AcquireLock attempts to acquire a distributed lock with a TTL. Returns a lockToken if acquired.
func (c *Client) AcquireLock(ctx context.Context, key string, ttl time.Duration) (string, bool, error) {
	token := uuid.New().String()
	acquired, err := c.Rdb.SetNX(ctx, "lock:"+key, token, ttl).Result()
	if err != nil {
		return "", false, err
	}
	return token, acquired, nil
}

// ReleaseLock releases the distributed lock only if the token matches (atomic via Lua script).
func (c *Client) ReleaseLock(ctx context.Context, key string, token string) (bool, error) {
	luaScript := `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end
	`
	res, err := c.Rdb.Eval(ctx, luaScript, []string{"lock:" + key}, token).Int64()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

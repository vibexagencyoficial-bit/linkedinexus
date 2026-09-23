package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Client struct {
	Pool *pgxpool.Pool
}

func New(ctx context.Context, databaseURL string) (*Client, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database url: %w", err)
	}

	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = 1 * time.Hour
	config.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &Client{Pool: pool}, nil
}

func (c *Client) Close() {
	if c.Pool != nil {
		c.Pool.Close()
	}
}

// ExecWithTenant executes a callback inside a database transaction with app.organization_id set for RLS.
func (c *Client) ExecWithTenant(ctx context.Context, orgID uuid.UUID, fn func(tx pgx.Tx) error) error {
	tx, err := c.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction error: %w", err)
	}
	defer tx.Rollback(ctx)

	// Set local session variable for Row Level Security (RLS). SET LOCAL nao
	// aceita placeholder ($1) — por isso usamos set_config com parametro, que
	// tem o mesmo efeito transacional (is_local=true) sem vazar para o pool.
	_, err = tx.Exec(ctx, `SELECT set_config('app.organization_id', $1, true)`, orgID.String())
	if err != nil {
		return fmt.Errorf("failed to set tenant RLS context: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

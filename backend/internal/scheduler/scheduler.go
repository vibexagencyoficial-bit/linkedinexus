package scheduler

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/queue"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/redis"
)

const (
	BatchLimit           = 100
	MaxQueueBackpressure = 1000
)

type EligibleItem struct {
	OrganizationID uuid.UUID
	CampaignID     uuid.UUID
	ContactID      uuid.UUID
	CurrentStepID  *uuid.UUID
	Position       int
}

type Service struct {
	pgClient    *postgres.Client
	redisClient *redis.Client
	asynqClient *asynq.Client
	interval    time.Duration
	stopCh      chan struct{}
}

func NewService(
	pgClient *postgres.Client,
	redisClient *redis.Client,
	asynqClient *asynq.Client,
	interval time.Duration,
) *Service {
	return &Service{
		pgClient:    pgClient,
		redisClient: redisClient,
		asynqClient: asynqClient,
		interval:    interval,
		stopCh:      make(chan struct{}),
	}
}

func (s *Service) Start(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	log := logger.New("info").With("service", "scheduler")
	log.Info("campaign scheduler process started", "interval", s.interval.String())

	for {
		select {
		case <-ctx.Done():
			log.Info("scheduler stopped due to context cancellation")
			return
		case <-s.stopCh:
			log.Info("scheduler received stop signal")
			return
		case <-ticker.C:
			if err := s.pollAndSchedule(ctx); err != nil {
				log.Error("error during scheduling cycle", "error", err)
			}
		}
	}
}

func (s *Service) Stop() {
	close(s.stopCh)
}

func (s *Service) pollAndSchedule(ctx context.Context) error {
	log := logger.New("debug").With("service", "scheduler")

	// 1. Backpressure Check: inspect active queue size in Redis
	queueSize, err := s.redisClient.Rdb.LLen(ctx, "asynq:{default}:pending").Result()
	if err == nil && queueSize > MaxQueueBackpressure {
		log.Warn("scheduler applying backpressure: queue depth exceeded safe limit", "depth", queueSize)
		return nil
	}

	// 2. Query eligible campaign_contacts with SKIP LOCKED
	rows, err := s.pgClient.Pool.Query(ctx, `
		SELECT cc.organization_id, cc.campaign_id, cc.contact_id, cc.current_step_id, cc.current_position
		FROM campaign_contacts cc
		JOIN campaigns c ON cc.campaign_id = c.id
		WHERE cc.status = 'waiting'
		  AND cc.next_execution_at <= NOW()
		  AND c.status = 'running'
		ORDER BY cc.next_execution_at ASC
		LIMIT $1
		FOR UPDATE OF cc SKIP LOCKED
	`, BatchLimit)
	if err != nil {
		return fmt.Errorf("failed to query eligible contacts: %w", err)
	}
	defer rows.Close()

	items := make([]EligibleItem, 0, BatchLimit)
	for rows.Next() {
		var item EligibleItem
		if err := rows.Scan(
			&item.OrganizationID,
			&item.CampaignID,
			&item.ContactID,
			&item.CurrentStepID,
			&item.Position,
		); err != nil {
			return fmt.Errorf("failed to scan eligible item: %w", err)
		}
		items = append(items, item)
	}

	if len(items) == 0 {
		return nil
	}

	log.Info("eligible contacts found for scheduling", "count", len(items))

	// 3. Process each eligible item with distributed lock and enqueue
	for _, item := range items {
		if item.CurrentStepID == nil {
			continue
		}

		lockKey := fmt.Sprintf("campaign:contact:%s:%s", item.CampaignID, item.ContactID)
		token, acquired, err := s.redisClient.AcquireLock(ctx, lockKey, 30*time.Second)
		if err != nil || !acquired {
			continue // Another worker/scheduler cycle is processing this contact
		}

		// Find default or connected LinkedIn account for this organization
		var accountID uuid.UUID
		err = s.pgClient.Pool.QueryRow(ctx, `
			SELECT id FROM linkedin_accounts
			WHERE organization_id = $1 AND connection_status = 'connected'
			LIMIT 1
		`, item.OrganizationID).Scan(&accountID)
		if err != nil {
			// No account connected, release lock and skip
			_, _ = s.redisClient.ReleaseLock(ctx, lockKey, token)
			continue
		}

		task, err := queue.NewStepExecuteTask(queue.StepExecutePayload{
			OrganizationID: item.OrganizationID,
			CampaignID:     item.CampaignID,
			ContactID:      item.ContactID,
			CampaignStepID: *item.CurrentStepID,
			Position:       item.Position,
			AccountID:      accountID,
		})
		if err != nil {
			_, _ = s.redisClient.ReleaseLock(ctx, lockKey, token)
			continue
		}

		// Enqueue into Asynq
		_, err = s.asynqClient.EnqueueContext(ctx, task)
		if err != nil {
			log.Error("failed to enqueue asynq task", "error", err, "contact_id", item.ContactID)
			_, _ = s.redisClient.ReleaseLock(ctx, lockKey, token)
			continue
		}

		// Update state to active/executing
		_, _ = s.pgClient.Pool.Exec(ctx, `
			UPDATE campaign_contacts
			SET status = 'active', updated_at = NOW()
			WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
		`, item.OrganizationID, item.CampaignID, item.ContactID)

		_, _ = s.redisClient.ReleaseLock(ctx, lockKey, token)
	}

	return nil
}

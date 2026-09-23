package messaging

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/ratelimit"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/templates"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/telemetry"
)

var (
	ErrStopOnReply      = errors.New("execution halted: contact replied")
	ErrDuplicateJob     = errors.New("execution halted: duplicate job already executed")
	ErrVariableMissing  = errors.New("execution halted: contact missing required template variables")
	ErrSafetyRestricted = errors.New("execution halted: platform safety or rate limit restricted")
)

type StepInfo struct {
	ID           uuid.UUID
	Position     int
	StepType     string
	Name         string
	TemplateBody string
	DelayAmount  int
	DelayUnit    string
}

type ContactInfo struct {
	ID        uuid.UUID
	FirstName string
	LastName  string
	FullName  string
	Company   string
	JobTitle  string
	Metadata  map[string]any
}

type MessageExecutor struct {
	pgClient      *postgres.Client
	safetyService *safety.PlatformSafetyService
	rateLimiter   *ratelimit.RateLimiter
	renderer      *templates.Renderer
}

func NewExecutor(
	pgClient *postgres.Client,
	safetyService *safety.PlatformSafetyService,
	rateLimiter *ratelimit.RateLimiter,
) *MessageExecutor {
	return &MessageExecutor{
		pgClient:      pgClient,
		safetyService: safetyService,
		rateLimiter:   rateLimiter,
		renderer:      templates.NewRenderer(),
	}
}

// ComputeIdempotencyKey generates a deterministic SHA256 hash for campaign + contact + step
func ComputeIdempotencyKey(campaignID, contactID, stepID uuid.UUID) string {
	raw := fmt.Sprintf("%s:%s:%s", campaignID.String(), contactID.String(), stepID.String())
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])
}

// ExecuteStep runs the message step through the full safety, idempotency and stop-on-reply pipeline
func (e *MessageExecutor) ExecuteStep(
	ctx context.Context,
	orgID uuid.UUID,
	campaignID uuid.UUID,
	contactID uuid.UUID,
	stepID uuid.UUID,
	accountID uuid.UUID,
) error {
	log := logger.WithContext(ctx, logger.New("info")).With(
		"org_id", orgID,
		"campaign_id", campaignID,
		"contact_id", contactID,
		"step_id", stepID,
	)

	telemetry.IncJobsProcessed()

	// 1. Transactional check for Stop on Reply directly before execution
	var hasReplied bool
	err := e.pgClient.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM messages m
			JOIN conversations c ON m.conversation_id = c.id
			WHERE c.organization_id = $1 
			  AND c.contact_id = $2 
			  AND m.direction = 'inbound'
		)
	`, orgID, contactID).Scan(&hasReplied)
	if err != nil {
		return fmt.Errorf("error checking reply state: %w", err)
	}

	if hasReplied {
		log.Warn("stop on reply triggered: contact has sent an inbound message")
		telemetry.IncRepliesDetected()

		// Update campaign_contact status to replied and cancel future steps
		_, _ = e.pgClient.Pool.Exec(ctx, `
			UPDATE campaign_contacts
			SET status = 'replied',
			    stop_reason = 'reply_detected',
			    stopped_at = NOW(),
			    updated_at = NOW()
			WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
		`, orgID, campaignID, contactID)

		return ErrStopOnReply
	}

	// 2. Fetch campaign and account state
	var campaignStatus string
	var accountStatus string
	var dailyLimit int
	err = e.pgClient.Pool.QueryRow(ctx, `
		SELECT c.status, COALESCE(la.connection_status, 'connected'), c.daily_limit
		FROM campaigns c
		LEFT JOIN linkedin_accounts la ON la.organization_id = c.organization_id AND la.id = $3
		WHERE c.organization_id = $1 AND c.id = $2
	`, orgID, campaignID, accountID).Scan(&campaignStatus, &accountStatus, &dailyLimit)
	if err != nil {
		return fmt.Errorf("failed to fetch campaign/account state: %w", err)
	}

	// 3. Platform Safety Evaluation
	eval := e.safetyService.EvaluateExecution(ctx, orgID, accountID, accountStatus, campaignStatus)
	if !eval.Eligible {
		log.Warn("execution blocked by platform safety", "reason", eval.Reason)
		return fmt.Errorf("%w: %s", ErrSafetyRestricted, eval.Reason)
	}

	// 4. Rate Limiter Evaluation
	canExec, rlReason, err := e.rateLimiter.CanExecuteAccount(ctx, accountID, dailyLimit)
	if err != nil {
		return fmt.Errorf("rate limiter error: %w", err)
	}
	if !canExec {
		log.Warn("execution blocked by rate limiter", "reason", rlReason)
		return fmt.Errorf("%w: %s", ErrSafetyRestricted, rlReason)
	}

	// 5. Fetch Contact and Step details
	var contact ContactInfo
	err = e.pgClient.Pool.QueryRow(ctx, `
		SELECT id, first_name, last_name, full_name, company, job_title
		FROM contacts
		WHERE organization_id = $1 AND id = $2
	`, orgID, contactID).Scan(
		&contact.ID, &contact.FirstName, &contact.LastName, &contact.FullName, &contact.Company, &contact.JobTitle,
	)
	if err != nil {
		return fmt.Errorf("failed to fetch contact: %w", err)
	}

	var step StepInfo
	err = e.pgClient.Pool.QueryRow(ctx, `
		SELECT id, position, step_type, name, template_body, delay_amount, delay_unit
		FROM campaign_steps
		WHERE organization_id = $1 AND id = $2
	`, orgID, stepID).Scan(
		&step.ID, &step.Position, &step.StepType, &step.Name, &step.TemplateBody, &step.DelayAmount, &step.DelayUnit,
	)
	if err != nil {
		return fmt.Errorf("failed to fetch step: %w", err)
	}

	// 6. Template Rendering with NeedsReview check
	renderResult := e.renderer.Render(step.TemplateBody, templates.ContactData{
		FirstName: contact.FirstName,
		LastName:  contact.LastName,
		FullName:  contact.FullName,
		Company:   contact.Company,
		JobTitle:  contact.JobTitle,
	})

	if renderResult.NeedsReview {
		log.Warn("template rendering flagged for review due to missing variables", "missing", renderResult.MissingVars)
		_, _ = e.pgClient.Pool.Exec(ctx, `
			UPDATE campaign_contacts
			SET status = 'needs_review',
			    stop_reason = 'missing_variables',
			    stopped_at = NOW(),
			    updated_at = NOW()
			WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3
		`, orgID, campaignID, contactID)
		return ErrVariableMissing
	}

	// 7. Enfileirar o job de forma IDEMPOTENTE e HONESTA. Pipeline único:
	// a entrega real acontece na extensão Chrome do usuário — este handler
	// NUNCA grava 'sent' nem cria conversation/message (isso é papel do
	// /messaging/report-sent quando a extensão confirma o envio no LinkedIn).
	idempotencyKey := ComputeIdempotencyKey(campaignID, contactID, stepID)

	txErr := e.pgClient.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		var jobID uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO message_jobs (
				organization_id, campaign_id, contact_id, campaign_step_id,
				idempotency_key, rendered_content, status, attempts
			) VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0)
			ON CONFLICT (campaign_id, contact_id, campaign_step_id) DO NOTHING
			RETURNING id
		`, orgID, campaignID, contactID, stepID, idempotencyKey, renderResult.RenderedText).Scan(&jobID)

		if errors.Is(err, pgx.ErrNoRows) {
			// Job já enfileirado anteriormente — idempotência, não sucesso.
			log.Info("job already queued (idempotency key match)", "idempotency_key", idempotencyKey)
			return ErrDuplicateJob
		}
		if err != nil {
			return fmt.Errorf("failed to insert message job: %w", err)
		}

		// Evento de fila para rastreamento em tempo real no painel.
		_, err = tx.Exec(ctx, `
			INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
			VALUES ($1, 'message', $2, 'message.queued', json_build_object(
				'campaign_id', $3::text,
				'contact_id', $4::text,
				'contact_name', $7::text,
				'step_id', $5::text,
				'position', $6::int
			))
		`, orgID, jobID, campaignID, contactID, stepID, step.Position, contact.FullName)

		return err
	})

	if errors.Is(txErr, ErrDuplicateJob) {
		return nil // Handled gracefully as idempotent
	}
	if txErr != nil {
		telemetry.IncJobsFailed()
		return txErr
	}

	// NÃO registrar execução no rate limiter nem sucesso no circuit breaker:
	// enfileirar não é entregar. O registro real acontece no report-sent
	// (API), quando a extensão confirma o envio.

	log.Info("message job queued for extension delivery", "idempotency_key", idempotencyKey)
	return nil
}

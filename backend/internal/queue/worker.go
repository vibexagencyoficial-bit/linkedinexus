package queue

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/messaging"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
)

type WorkerHandler struct {
	executor *messaging.MessageExecutor
}

func NewWorkerHandler(executor *messaging.MessageExecutor) *WorkerHandler {
	return &WorkerHandler{
		executor: executor,
	}
}

func (h *WorkerHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := logger.New("info").With("type", t.Type())

	switch t.Type() {
	case TypeCampaignStepExecute:
		var p StepExecutePayload
		if err := json.Unmarshal(t.Payload(), &p); err != nil {
			return fmt.Errorf("failed to unmarshal StepExecutePayload: %w", asynq.SkipRetry)
		}

		ctx = context.WithValue(ctx, logger.OrganizationIDKey, p.OrganizationID.String())
		ctx = context.WithValue(ctx, logger.JobIDKey, t.ResultWriter().TaskID())

		log.Info("worker executing campaign step",
			"campaign_id", p.CampaignID,
			"contact_id", p.ContactID,
			"step_id", p.CampaignStepID,
			"position", p.Position,
		)

		err := h.executor.ExecuteStep(
			ctx,
			p.OrganizationID,
			p.CampaignID,
			p.ContactID,
			p.CampaignStepID,
			p.AccountID,
		)
		if err != nil {
			log.Error("error during step execution", "error", err)
			return err
		}

		return nil

	default:
		return fmt.Errorf("unrecognized task type: %s", t.Type())
	}
}

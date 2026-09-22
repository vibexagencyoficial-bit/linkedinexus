package queue

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

const (
	TypeCampaignStepExecute    = "campaign:step:execute"
	TypeCampaignContactSchedule = "campaign:contact:schedule"
	TypeCampaignFollowupSchedule = "campaign:followup:schedule"
	TypeConversationSync       = "conversation:sync"
	TypeCampaignMetricsUpdate  = "campaign:metrics:update"
)

type StepExecutePayload struct {
	OrganizationID   uuid.UUID `json:"organization_id"`
	CampaignID       uuid.UUID `json:"campaign_id"`
	ContactID        uuid.UUID `json:"contact_id"`
	CampaignStepID   uuid.UUID `json:"campaign_step_id"`
	Position         int       `json:"position"`
	AccountID        uuid.UUID `json:"account_id"`
}

func NewStepExecuteTask(payload StepExecutePayload) (*asynq.Task, error) {
	bytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal task payload: %w", err)
	}

	// Task ID for Asynq deduplication
	taskID := fmt.Sprintf("step:%s:%s:%s", payload.CampaignID, payload.ContactID, payload.CampaignStepID)

	return asynq.NewTask(
		TypeCampaignStepExecute,
		bytes,
		asynq.TaskID(taskID),
		asynq.MaxRetry(3),
		asynq.Timeout(2*time.Minute),
	), nil
}

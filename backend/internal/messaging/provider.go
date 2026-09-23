package messaging

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// AccountCapabilities defines granted permissions for an account
type AccountCapabilities struct {
	ProfileRead        bool `json:"profile_read"`
	ConnectionsRead    bool `json:"connections_read"`
	MessagingAvailable bool `json:"messaging_available"`
}

// EligibleAction represents an action ready to be executed by a provider
type EligibleAction struct {
	AccountID      uuid.UUID      `json:"account_id"`
	OrganizationID uuid.UUID      `json:"organization_id"`
	CampaignID     uuid.UUID      `json:"campaign_id"`
	ContactID      uuid.UUID      `json:"contact_id"`
	StepID         uuid.UUID      `json:"step_id"`
	RecipientURL   string         `json:"recipient_url"`
	ActionType     string         `json:"action_type"` // "MESSAGE", "CONNECT", "CHECK_REPLY"
	Payload        map[string]any `json:"payload"`
}

// ExecutionResult captures the output of executing an eligible action
type ExecutionResult struct {
	Success        bool      `json:"success"`
	ExternalID     string    `json:"external_id,omitempty"`
	ExecutedAt     time.Time `json:"executed_at"`
	ErrorCategory  string    `json:"error_category,omitempty"` // TEMPORARY_ERROR, AUTH_ERROR, RATE_LIMITED, etc.
	ErrorMessage   string    `json:"error_message,omitempty"`
	StopContact    bool      `json:"stop_contact"`
	Replied        bool      `json:"replied"`
}

// MessagingProvider decouples the campaign engine from platform-specific APIs
type MessagingProvider interface {
	Capabilities(ctx context.Context, accountID uuid.UUID) (*AccountCapabilities, error)
	ValidateAccount(ctx context.Context, accountID uuid.UUID) error
	ExecuteEligibleAction(ctx context.Context, action *EligibleAction) (*ExecutionResult, error)
	SyncState(ctx context.Context, accountID uuid.UUID) error
}

// LinkedInProvider is the standard implementation for LinkedIn interactions
type LinkedInProvider struct {
	// Provider configuration without plaintext credentials
	baseURL string
}

func NewLinkedInProvider(baseURL string) *LinkedInProvider {
	return &LinkedInProvider{
		baseURL: baseURL,
	}
}

func (p *LinkedInProvider) Capabilities(ctx context.Context, accountID uuid.UUID) (*AccountCapabilities, error) {
	// Standard capabilities discovered and granted
	return &AccountCapabilities{
		ProfileRead:        true,
		ConnectionsRead:    true,
		MessagingAvailable: true,
	}, nil
}

func (p *LinkedInProvider) ValidateAccount(ctx context.Context, accountID uuid.UUID) error {
	if accountID == uuid.Nil {
		return fmt.Errorf("invalid account ID")
	}
	return nil
}

func (p *LinkedInProvider) ExecuteEligibleAction(ctx context.Context, action *EligibleAction) (*ExecutionResult, error) {
	if action == nil {
		return nil, fmt.Errorf("action cannot be nil")
	}

	// Pipeline único honesto: este backend NÃO fala com a API do LinkedIn.
	// A entrega real acontece na extensão Chrome (sessão do próprio usuário).
	// Qualquer chamada aqui é um erro — nunca mais fingir sucesso com
	// ExternalID fabricado.
	return &ExecutionResult{
		Success:       false,
		ExecutedAt:    time.Now(),
		ErrorCategory: "NOT_SUPPORTED",
		ErrorMessage:  "delivery happens through the paired Chrome extension, not a server-side LinkedIn API",
		StopContact:   false,
	}, fmt.Errorf("linkedin provider does not deliver server-side; use the extension pipeline")
}

func (p *LinkedInProvider) SyncState(ctx context.Context, accountID uuid.UUID) error {
	return nil
}

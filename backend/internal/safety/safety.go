package safety

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

type CircuitState string

const (
	StateClosed   CircuitState = "closed"
	StateOpen     CircuitState = "open"
	StateHalfOpen CircuitState = "half_open"
)

type ErrorCategory string

const (
	ErrorTemporary           ErrorCategory = "temporary_error"
	ErrorAuth                ErrorCategory = "auth_error"
	ErrorRateLimited         ErrorCategory = "rate_limited"
	ErrorPlatformRestriction ErrorCategory = "platform_restriction"
	ErrorActionRequired      ErrorCategory = "action_required"
	ErrorPermanent           ErrorCategory = "permanent_error"
	ErrorUnknown             ErrorCategory = "unknown_error"
)

type CircuitBreaker struct {
	mu           sync.RWMutex
	State        CircuitState
	Failures     int
	MaxFailures  int
	Cooldown     time.Duration
	LastOpenedAt time.Time
}

func NewCircuitBreaker(maxFailures int, cooldown time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		State:       StateClosed,
		MaxFailures: maxFailures,
		Cooldown:    cooldown,
	}
}

func (cb *CircuitBreaker) CanExecute() (bool, string) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.State == StateClosed {
		return true, ""
	}

	if cb.State == StateOpen {
		if time.Since(cb.LastOpenedAt) > cb.Cooldown {
			cb.State = StateHalfOpen
			return true, "entering half-open trial"
		}
		remaining := cb.Cooldown - time.Since(cb.LastOpenedAt)
		return false, fmt.Sprintf("circuit open: cooling down for %v", remaining.Round(time.Second))
	}

	// In half-open state, allow a single controlled test
	return true, "half-open probe execution"
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.State = StateClosed
	cb.Failures = 0
}

func (cb *CircuitBreaker) RecordFailure(cat ErrorCategory) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// High-risk restriction errors immediately trip the circuit breaker to OPEN
	if cat == ErrorRateLimited || cat == ErrorPlatformRestriction || cat == ErrorActionRequired {
		cb.State = StateOpen
		cb.LastOpenedAt = time.Now()
		return
	}

	cb.Failures++
	if cb.Failures >= cb.MaxFailures {
		cb.State = StateOpen
		cb.LastOpenedAt = time.Now()
	}
}

type PlatformSafetyService struct {
	breakers   sync.Map // map[uuid.UUID]*CircuitBreaker
	killSwitch sync.Map // map[uuid.UUID]bool (true = paused)
}

func NewPlatformSafetyService() *PlatformSafetyService {
	return &PlatformSafetyService{}
}

func (s *PlatformSafetyService) GetCircuitBreaker(accountID uuid.UUID) *CircuitBreaker {
	cb, _ := s.breakers.LoadOrStore(accountID, NewCircuitBreaker(3, 15*time.Minute))
	return cb.(*CircuitBreaker)
}

// SetGlobalKillSwitch enables or disables the emergency pause for an organization
func (s *PlatformSafetyService) SetGlobalKillSwitch(orgID uuid.UUID, pause bool) {
	s.killSwitch.Store(orgID, pause)
}

func (s *PlatformSafetyService) IsGlobalKillSwitchActive(orgID uuid.UUID) bool {
	val, ok := s.killSwitch.Load(orgID)
	if !ok {
		return false
	}
	return val.(bool)
}

type EligibilityEvaluation struct {
	Eligible bool
	Reason   string
}

func (s *PlatformSafetyService) EvaluateExecution(
	ctx context.Context,
	orgID uuid.UUID,
	accountID uuid.UUID,
	accountStatus string,
	campaignStatus string,
) EligibilityEvaluation {
	// 1. Check Global Emergency Kill Switch
	if s.IsGlobalKillSwitchActive(orgID) {
		return EligibilityEvaluation{
			Eligible: false,
			Reason:   "execution blocked: Global Kill Switch (PAUSE ALL OUTREACH) is active",
		}
	}

	// 2. Check Campaign Status
	if campaignStatus != "running" {
		return EligibilityEvaluation{
			Eligible: false,
			Reason:   fmt.Sprintf("campaign is not in running state (current: %s)", campaignStatus),
		}
	}

	// 3. Check Account Status
	if accountStatus == "restricted" || accountStatus == "action_required" {
		return EligibilityEvaluation{
			Eligible: false,
			Reason:   fmt.Sprintf("linkedin account status prohibits outreach (current: %s)", accountStatus),
		}
	}

	// 4. Check Circuit Breaker
	cb := s.GetCircuitBreaker(accountID)
	canExec, reason := cb.CanExecute()
	if !canExec {
		return EligibilityEvaluation{
			Eligible: false,
			Reason:   fmt.Sprintf("circuit breaker protection active: %s", reason),
		}
	}

	return EligibilityEvaluation{
		Eligible: true,
		Reason:   "authorized for execution",
	}
}

func ClassifyError(err error) ErrorCategory {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return ErrorTemporary
	case containsAny(msg, "rate limit", "too many requests", "429"):
		return ErrorRateLimited
	case containsAny(msg, "checkpoint", "captcha", "security verification", "challenge"):
		return ErrorActionRequired
	case containsAny(msg, "restricted", "suspended", "blocked", "banned"):
		return ErrorPlatformRestriction
	case containsAny(msg, "unauthorized", "invalid token", "session expired", "401"):
		return ErrorAuth
	default:
		return ErrorTemporary
	}
}

func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if len(s) >= len(sub) && (s == sub || stringContains(s, sub)) {
			return true
		}
	}
	return false
}

func stringContains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) > 0 && searchSubstr(s, substr))
}

func searchSubstr(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

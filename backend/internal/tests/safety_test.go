package tests

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/messaging"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/safety"
)

func TestIdempotency_DeterministicKey(t *testing.T) {
	campaignID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	contactID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	stepID := uuid.MustParse("33333333-3333-3333-3333-333333333333")

	// Generating key 10 times in a row
	firstKey := messaging.ComputeIdempotencyKey(campaignID, contactID, stepID)
	for i := 0; i < 10; i++ {
		key := messaging.ComputeIdempotencyKey(campaignID, contactID, stepID)
		if key != firstKey {
			t.Fatalf("idempotency key is not deterministic! expected %s, got %s", firstKey, key)
		}
	}
}

func TestCircuitBreaker_StateTransitions(t *testing.T) {
	cb := safety.NewCircuitBreaker(3, 100*time.Millisecond)

	// Initially CLOSED
	canExec, _ := cb.CanExecute()
	if !canExec || cb.State != safety.StateClosed {
		t.Fatalf("expected initial state CLOSED, got %s", cb.State)
	}

	// 1 failure
	cb.RecordFailure(safety.ErrorTemporary)
	if cb.State != safety.StateClosed {
		t.Fatalf("expected still CLOSED after 1 temporary failure")
	}

	// Immediate trip on platform restriction
	cb.RecordFailure(safety.ErrorPlatformRestriction)
	if cb.State != safety.StateOpen {
		t.Fatalf("expected state OPEN after platform restriction, got %s", cb.State)
	}

	// Cannot execute while OPEN
	canExec, reason := cb.CanExecute()
	if canExec {
		t.Fatalf("expected CanExecute to return false while OPEN")
	}
	if reason == "" {
		t.Errorf("expected reason message while OPEN")
	}

	// Wait for cooldown to transition to HALF_OPEN
	time.Sleep(120 * time.Millisecond)
	canExec, trialReason := cb.CanExecute()
	if !canExec || cb.State != safety.StateHalfOpen {
		t.Fatalf("expected transition to HALF_OPEN after cooldown, got %s (%s)", cb.State, trialReason)
	}

	// Success restores to CLOSED
	cb.RecordSuccess()
	if cb.State != safety.StateClosed {
		t.Fatalf("expected state CLOSED after record success, got %s", cb.State)
	}
}

func TestPlatformSafety_GlobalKillSwitch(t *testing.T) {
	ps := safety.NewPlatformSafetyService()
	orgID := uuid.New()
	accountID := uuid.New()

	// Normal operation
	eval := ps.EvaluateExecution(context.Background(), orgID, accountID, "connected", "running")
	if !eval.Eligible {
		t.Fatalf("expected eligible under normal conditions, got: %s", eval.Reason)
	}

	// Activate Global Emergency Kill Switch (PAUSE ALL OUTREACH)
	ps.SetGlobalKillSwitch(orgID, true)
	evalBlocked := ps.EvaluateExecution(context.Background(), orgID, accountID, "connected", "running")
	if evalBlocked.Eligible {
		t.Fatalf("expected execution to be blocked when Global Kill Switch is active")
	}

	// Deactivate
	ps.SetGlobalKillSwitch(orgID, false)
	evalRestored := ps.EvaluateExecution(context.Background(), orgID, accountID, "connected", "running")
	if !evalRestored.Eligible {
		t.Fatalf("expected execution to be restored, got: %s", evalRestored.Reason)
	}
}

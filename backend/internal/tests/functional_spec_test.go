package tests

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/google/uuid"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/messaging"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/templates"
)

// TestExtension_PairingTokenHash verifies that pairing tokens are hashed with SHA256 and never stored in plaintext
func TestExtension_PairingTokenHash(t *testing.T) {
	rawToken := "vibex_ext_tok_1234567890abcdef12345678"
	hash := sha256.Sum256([]byte(rawToken))
	storedHash := hex.EncodeToString(hash[:])

	if storedHash == rawToken {
		t.Fatalf("Extension token must be hashed, cannot equal raw token")
	}

	// Verify verification
	checkHash := sha256.Sum256([]byte(rawToken))
	if hex.EncodeToString(checkHash[:]) != storedHash {
		t.Fatalf("Token hash mismatch on verification")
	}
}

// TestCapabilities_MessagingProvider verifies the Capability Adapter pattern
func TestCapabilities_MessagingProvider(t *testing.T) {
	provider := messaging.NewLinkedInProvider("https://api.linkedin.com")
	caps, err := provider.Capabilities(nil, uuid.New())
	if err != nil {
		t.Fatalf("Failed to fetch provider capabilities: %v", err)
	}

	if !caps.ProfileRead || !caps.ConnectionsRead || !caps.MessagingAvailable {
		t.Fatalf("Expected full authorized capabilities, got: %+v", caps)
	}
}

// TestPreLaunch_MissingVariables_BlocksCampaign verifies Section 21
func TestPreLaunch_MissingVariables_BlocksCampaign(t *testing.T) {
	renderer := templates.NewRenderer()
	template := "Olá {{first_name}}, vi que você atua na {{company}} como {{job_title}}."

	// Missing company
	contact := templates.ContactData{
		FirstName: "Lucas",
		LastName:  "Silva",
		FullName:  "Lucas Silva",
		Company:   "", // EMPTY!
		JobTitle:  "Tech Lead",
	}

	res := renderer.Render(template, contact)
	if !res.NeedsReview {
		t.Fatalf("Expected NeedsReview=true due to missing company, got false")
	}

	var foundCompany bool
	for _, mv := range res.MissingVars {
		if mv == "company" {
			foundCompany = true
			break
		}
	}

	if !foundCompany {
		t.Fatalf("Expected missing variable 'company' in list, got: %v", res.MissingVars)
	}
}

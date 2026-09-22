package tests

import (
	"testing"

	"github.com/vibexcorp/linkedin-outreach/backend/internal/templates"
)

func TestTemplateRenderer_Success(t *testing.T) {
	renderer := templates.NewRenderer()
	tmpl := "Olá {{first_name}}, vi que você trabalha na {{company}} como {{job_title}}."
	contact := templates.ContactData{
		FirstName: "Gustavo",
		LastName:  "Silveira",
		FullName:  "Gustavo Silveira",
		Company:   "GLB Metalúrgica",
		JobTitle:  "Diretor Industrial",
	}

	result := renderer.Render(tmpl, contact)

	if result.NeedsReview {
		t.Fatalf("expected NeedsReview to be false, got true with missing: %v", result.MissingVars)
	}

	expected := "Olá Gustavo, vi que você trabalha na GLB Metalúrgica como Diretor Industrial."
	if result.RenderedText != expected {
		t.Errorf("expected rendered text '%s', got '%s'", expected, result.RenderedText)
	}
}

func TestTemplateRenderer_MissingVariable_FlagsNeedsReview(t *testing.T) {
	renderer := templates.NewRenderer()
	tmpl := "Olá {{first_name}}, vi que você atua na {{company}}."
	contact := templates.ContactData{
		FirstName: "Gustavo",
		Company:   "", // Missing mandatory company!
	}

	result := renderer.Render(tmpl, contact)

	if !result.NeedsReview {
		t.Fatalf("expected NeedsReview to be true when company is missing")
	}

	if len(result.MissingVars) != 1 || result.MissingVars[0] != "company" {
		t.Errorf("expected missing vars to contain 'company', got: %v", result.MissingVars)
	}
}

func TestTemplateRenderer_CustomMetadata(t *testing.T) {
	renderer := templates.NewRenderer()
	tmpl := "Olá {{first_name}}, como estão as operações em {{city}} no setor de {{industry}}?"
	contact := templates.ContactData{
		FirstName: "Ana",
		Metadata: map[string]any{
			"city":     "Joinville",
			"industry": "Metalmecânico",
		},
	}

	result := renderer.Render(tmpl, contact)
	if result.NeedsReview {
		t.Fatalf("unexpected NeedsReview: %v", result.MissingVars)
	}

	expected := "Olá Ana, como estão as operações em Joinville no setor de Metalmecânico?"
	if result.RenderedText != expected {
		t.Errorf("expected '%s', got '%s'", expected, result.RenderedText)
	}
}

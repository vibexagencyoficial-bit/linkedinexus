package templates

import (
	"fmt"
	"regexp"
	"strings"
)

var variableRegex = regexp.MustCompile(`\{\{([a-zA-Z0-9_-]+)\}\}`)

type ContactData struct {
	FirstName string
	LastName  string
	FullName  string
	Company   string
	JobTitle  string
	Metadata  map[string]any
}

type RenderResult struct {
	RenderedText string
	NeedsReview  bool
	MissingVars  []string
	Error        error
}

type Renderer struct{}

func NewRenderer() *Renderer {
	return &Renderer{}
}

// Render processes a template body with contact data.
// If any variable present in the template is empty or missing, it flags NeedsReview = true.
func (r *Renderer) Render(templateBody string, contact ContactData) RenderResult {
	if strings.TrimSpace(templateBody) == "" {
		return RenderResult{
			NeedsReview: true,
			MissingVars: []string{"template_empty"},
			Error:       fmt.Errorf("template body cannot be empty"),
		}
	}

	matches := variableRegex.FindAllStringSubmatch(templateBody, -1)
	missing := make([]string, 0)
	rendered := templateBody

	// Map of available standard fields
	values := map[string]string{
		"first_name": strings.TrimSpace(contact.FirstName),
		"last_name":  strings.TrimSpace(contact.LastName),
		"full_name":  strings.TrimSpace(contact.FullName),
		"company":    strings.TrimSpace(contact.Company),
		"job_title":  strings.TrimSpace(contact.JobTitle),
	}

	// Add custom variables from metadata
	if contact.Metadata != nil {
		for k, v := range contact.Metadata {
			if strVal, ok := v.(string); ok {
				values[strings.ToLower(k)] = strings.TrimSpace(strVal)
			}
		}
	}

	for _, match := range matches {
		fullMatch := match[0]   // e.g. "{{first_name}}"
		varName := strings.ToLower(match[1]) // e.g. "first_name"

		val, exists := values[varName]
		if !exists || val == "" {
			missing = append(missing, varName)
		} else {
			rendered = strings.ReplaceAll(rendered, fullMatch, val)
		}
	}

	if len(missing) > 0 {
		return RenderResult{
			RenderedText: templateBody,
			NeedsReview:  true,
			MissingVars:  missing,
			Error:        fmt.Errorf("missing required variables: %s", strings.Join(missing, ", ")),
		}
	}

	return RenderResult{
		RenderedText: rendered,
		NeedsReview:  false,
		MissingVars:  nil,
		Error:        nil,
	}
}

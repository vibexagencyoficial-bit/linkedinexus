package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Assist de automação humana — proxy para a API da Typesafe (Jev / System One).
//
// Contrato oficial (docs context7 /websites/typesafe_ai_sdk_javascript +
// server.mjs do MCP): POST {TYPESAFE_API_URL} com Authorization: Bearer e body
// {state, model, questions}; perguntas choice/score/noul; resposta
// answers.<nome>; erros 401/403/422 determinísticos, 429/529 transitórios
// (retry com retry-after).
//
// Regras de segurança (AGENTS.md): a chave NUNCA sai do backend (fica no
// .env); o `state` enviado é estrutural (seletores, fingerprint de página,
// timings) — nunca contém .env, tokens, cookies ou credenciais.

const (
	assistTimeout       = 8 * time.Second
	assistMaxRetries    = 2
	assistRatePerMin    = 10
	assistCacheCap      = 256
	assistCacheTTL      = 10 * time.Minute
	assistConfidenceMin = 0.5
)

type AssistService struct {
	apiURL string
	apiKey string
	model  string
	floor  float64
	client *http.Client

	cacheMu sync.Mutex
	cache   map[string]assistCacheEntry
	cacheLRU []string

	rateMu   sync.Mutex
	rateWin  time.Time
	rateSeen int
}

type assistCacheEntry struct {
	params   HumanizeParams
	expireAt time.Time
}

// HumanizeRequest chega da extensão via POST /assist/humanize (JWT).
type HumanizeRequest struct {
	Action          string   `json:"action"`
	Selectors       []string `json:"selectors"`
	PageFingerprint string   `json:"page_fingerprint"`
	Language        string   `json:"language"`
}

// HumanizeParams orienta o content script a agir como um humano agiria.
type HumanizeParams struct {
	AssistAvailable   bool    `json:"assist_available"`
	Source            string  `json:"source"` // "typesafe" | "fallback"
	ClickDelayMs      int     `json:"click_delay_ms"`
	TypeCpsMin        float64 `json:"type_cps_min"`
	TypeCpsMax        float64 `json:"type_cps_max"`
	PauseEveryMin     int     `json:"pause_every_min_chars"`
	PauseEveryMax     int     `json:"pause_every_max_chars"`
	PauseMsMin        int     `json:"pause_ms_min"`
	PauseMsMax        int     `json:"pause_ms_max"`
	MouseStepsMin     int     `json:"mouse_steps_min"`
	MouseStepsMax     int     `json:"mouse_steps_max"`
	ScrollDwellMs     int     `json:"scroll_dwell_ms"`
	SuggestedSelector string  `json:"suggested_selector,omitempty"`
	PageState         string  `json:"page_state,omitempty"`
	Confidence        float64 `json:"confidence,omitempty"`
}

func NewAssistServiceFromEnv() *AssistService {
	return &AssistService{
		apiURL: os.Getenv("TYPESAFE_API_URL"),
		apiKey: os.Getenv("TYPESAFE_API_KEY"),
		model:  os.Getenv("TYPESAFE_MODEL"),
		floor:  assistConfidenceMin,
		client: &http.Client{Timeout: assistTimeout},
		cache:  make(map[string]assistCacheEntry),
	}
}

// fallbackParams é a curva determinística local (humano "padrão") usada
// sempre que o assist não está disponível — nunca fingimos ajuda da IA.
func fallbackParams(reason string) HumanizeParams {
	return HumanizeParams{
		AssistAvailable: false,
		Source:          "fallback",
		ClickDelayMs:    randInt(900, 2200),
		TypeCpsMin:      4.2,
		TypeCpsMax:      7.5,
		PauseEveryMin:   18,
		PauseEveryMax:   34,
		PauseMsMin:      300,
		PauseMsMax:      950,
		MouseStepsMin:   18,
		MouseStepsMax:   36,
		ScrollDwellMs:   randInt(400, 1200),
		PageState:       reason,
	}
}

func randInt(min, max int) int {
	if max <= min {
		return min
	}
	return min + rand.Intn(max-min)
}

// HandleAssistHumanize responde SEMPRE 200 com parâmetros; quando o assist
// não participa (sem chave, rate limit, erro, confiança abaixo do piso) a
// resposta vem com assist_available=false + source=fallback — contrato
// honesto, a extensão sabe exatamente quem guiou a automação.
func (s *Server) HandleAssistHumanize(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := tenantOr401(w, r); !ok {
		return
	}

	var req HumanizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return
	}
	if strings.TrimSpace(req.Action) == "" {
		writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "action is required", nil)
		return
	}

	if s.assist == nil || s.assist.apiKey == "" || s.assist.apiURL == "" {
		writeJSON(w, http.StatusOK, fallbackParams("assist_not_configured"))
		return
	}
	if !s.assist.allowRequest() {
		writeJSON(w, http.StatusOK, fallbackParams("assist_rate_limited"))
		return
	}

	cacheKey := s.assist.cacheKey(req)
	if params, ok := s.assist.cacheGet(cacheKey); ok {
		writeJSON(w, http.StatusOK, params)
		return
	}

	params, ok := s.assist.askTypesafe(r.Context(), req)
	if !ok {
		params = fallbackParams("assist_unavailable")
	}
	s.assist.cacheSet(cacheKey, params)
	writeJSON(w, http.StatusOK, params)
}

func (a *AssistService) allowRequest() bool {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	now := time.Now()
	if now.Sub(a.rateWin) > time.Minute {
		a.rateWin = now
		a.rateSeen = 0
	}
	if a.rateSeen >= assistRatePerMin {
		return false
	}
	a.rateSeen++
	return true
}

func (a *AssistService) cacheKey(req HumanizeRequest) string {
	sum := sha256.Sum256([]byte(req.Action + "|" + req.PageFingerprint + "|" + strings.Join(req.Selectors, ",")))
	return hex.EncodeToString(sum[:])
}

func (a *AssistService) cacheGet(key string) (HumanizeParams, bool) {
	a.cacheMu.Lock()
	defer a.cacheMu.Unlock()
	entry, ok := a.cache[key]
	if !ok || time.Now().After(entry.expireAt) {
		return HumanizeParams{}, false
	}
	return entry.params, true
}

func (a *AssistService) cacheSet(key string, params HumanizeParams) {
	a.cacheMu.Lock()
	defer a.cacheMu.Unlock()
	a.cache[key] = assistCacheEntry{params: params, expireAt: time.Now().Add(assistCacheTTL)}
	a.cacheLRU = append(a.cacheLRU, key)
	if len(a.cacheLRU) > assistCacheCap {
		evict := a.cacheLRU[0]
		a.cacheLRU = a.cacheLRU[1:]
		delete(a.cache, evict)
	}
}

// typesafePayload monta o corpo {state, model, questions} no formato oficial.
type typesafeQuestion struct {
	Type         string   `json:"type"`
	Instructions string   `json:"instructions,omitempty"`
	Criteria     []string `json:"criteria,omitempty"`
}

func (a *AssistService) askTypesafe(ctx context.Context, req HumanizeRequest) (HumanizeParams, bool) {
	// State estrutural somente — sem dados de usuário, sem credenciais.
	state := map[string]any{
		"action":     req.Action,
		"page":       req.PageFingerprint,
		"selectors":  req.Selectors,
		"language":   req.Language,
		"goal":       "automacao de outreach com comportamento humano no LinkedIn",
	}

	questions := map[string]typesafeQuestion{
		"page_state": {
			Type:         "choice",
			Instructions: "Classifique o estado atual da página do LinkedIn a partir dos seletores disponíveis.",
			Criteria:     []string{"message_box_open", "profile_page", "conversation_open", "error_or_blocked", "unknown"},
		},
		"selector": {
			Type:         "choice",
			Instructions: "Qual seletor CSS é o alvo correto da ação agora? Responda exatamente um dos seletores listados.",
			Criteria:     normalizeSelectors(req.Selectors),
		},
		"pacing": {
			Type:         "noul",
			Instructions: "A automação deve usar ritmo mais lento e pausado (mais humano) nesta execução?",
		},
	}

	body, _ := json.Marshal(map[string]any{
		"state":     state,
		"model":     a.model,
		"questions": questions,
	})

	var lastErr error
	for attempt := 0; attempt <= assistMaxRetries; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.apiURL, bytes.NewReader(body))
		if err != nil {
			return HumanizeParams{}, false
		}
		httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)
		httpReq.Header.Set("Content-Type", "application/json")

		resp, err := a.client.Do(httpReq)
		if err != nil {
			lastErr = err
			break // rede: sem retry infinito, cai no fallback
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == 529 {
			delay := time.Duration(500*(1<<attempt)) * time.Millisecond
			if ra, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && ra > 0 && ra <= 10 {
				delay = time.Duration(ra) * time.Second
			}
			resp.Body.Close()
			lastErr = errHTTP("transient " + resp.Status)
			select {
			case <-ctx.Done():
				return HumanizeParams{}, false
			case <-time.After(delay):
				continue
			}
		}
		if resp.StatusCode >= 400 {
			resp.Body.Close()
			lastErr = errHTTP("typesafe " + resp.Status)
			break // 401/403/422: determinístico, sem retry
		}

		var parsed struct {
			Answers map[string]struct {
				Type       string             `json:"type"`
				Choice     string             `json:"choice"`
				Noul       float64            `json:"noul"`
				Score      int                `json:"score"`
				Confidence float64            `json:"confidence"`
				Probs      map[string]float64 `json:"probabilities"`
			} `json:"answers"`
		}
		err = json.NewDecoder(resp.Body).Decode(&parsed)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			break
		}

		params := fallbackParams("")
		params.AssistAvailable = true
		params.Source = "typesafe"

		conf := 1.0
		if ans, ok := parsed.Answers["page_state"]; ok && ans.Choice != "" {
			params.PageState = ans.Choice
			conf = minFloat(conf, ans.Confidence)
		}
		if ans, ok := parsed.Answers["selector"]; ok && ans.Choice != "" {
			params.SuggestedSelector = ans.Choice
			conf = minFloat(conf, ans.Confidence)
		}
		if ans, ok := parsed.Answers["pacing"]; ok {
			conf = minFloat(conf, ans.Confidence)
			if ans.Noul >= 0.5 {
				params.ClickDelayMs *= 2
				params.TypeCpsMin *= 0.7
				params.TypeCpsMax *= 0.75
				params.PauseMsMin *= 2
				params.PauseMsMax = params.PauseMsMax*3/2 + 200
			}
		}
		params.Confidence = conf
		if conf < a.floor {
			// Confiança abaixo do piso (mesma regra do AGENTS.md p/ o Jev):
			// não agir sobre a resposta — fallback honesto.
			return fallbackParams("assist_low_confidence"), false
		}
		return params, true
	}
	_ = lastErr
	return HumanizeParams{}, false
}

type httpError string

func (e httpError) Error() string { return string(e) }

func errHTTP(msg string) error { return httpError(msg) }

func normalizeSelectors(selectors []string) []string {
	out := make([]string, 0, len(selectors))
	for _, sel := range selectors {
		sel = strings.TrimSpace(sel)
		if sel != "" {
			out = append(out, sel)
		}
		if len(out) >= 6 {
			break
		}
	}
	if len(out) == 0 {
		out = append(out, "none")
	}
	return out
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
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
	assistTimeout    = 8 * time.Second
	assistMaxRetries = 2
	assistCacheCap   = 256
	assistCacheTTL   = 10 * time.Minute

	// Defaults configuráveis via env (o Jev é o decisor: floor de confiança
	// e limite de requisições não podem ficar engessados em hardcode).
	defaultAssistRatePerMin    = 60
	defaultAssistConfidenceMin = 0.5
)

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f >= 0 && f <= 1 {
			return f
		}
	}
	return def
}

type AssistService struct {
	apiURL    string
	apiKey    string
	model     string
	floor     float64
	rateLimit int
	client    *http.Client

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
	// PacingLevel é a DECISÃO do Jev (conservative/moderate/energetic) que
	// gerou estes números — aparece no log e na auditoria do report-sent.
	PacingLevel string `json:"pacing_level,omitempty"`
	// Métricas de latência (medidor do algoritmo): quanto tempo o Jev levou
	// para decidir. jev_ms = soma do HTTP puro à Typesafe (0 quando não houve
	// chamada: cache/fallback/erro); assist_total_ms = handler completo
	// (cache + Jev + fallback); cached = veio do cache (jev_ms=0 esperado).
	JevMs         int64 `json:"jev_ms"`
	AssistTotalMs int64 `json:"assist_total_ms"`
	Cached        bool  `json:"cached,omitempty"`
}

// assistLog: logger JSON no stdout (vai para D:/vibex/logs/api.log via
// redirect do start.ps1). NUNCA loga chave, token, cookie ou credencial —
// só decisões estruturais (quem guiou, nível decidido, confiança, motivo).
func assistLog() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, nil))
}

func NewAssistServiceFromEnv() *AssistService {
	return &AssistService{
		apiURL:    os.Getenv("TYPESAFE_API_URL"),
		apiKey:    os.Getenv("TYPESAFE_API_KEY"),
		model:     os.Getenv("TYPESAFE_MODEL"),
		floor:     envFloat("JEV_CONFIDENCE_FLOOR", defaultAssistConfidenceMin),
		rateLimit: envInt("ASSIST_RATE_PER_MIN", defaultAssistRatePerMin),
		client:    &http.Client{Timeout: assistTimeout},
		cache:     make(map[string]assistCacheEntry),
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
	handlerStart := time.Now()

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
		p := fallbackParams("assist_not_configured")
		p.AssistTotalMs = time.Since(handlerStart).Milliseconds()
		assistLog().Warn("assist fallback: chave/URL Typesafe ausentes — configure TYPESAFE_API_URL/KEY",
			"reason", "assist_not_configured", "jev_ms", p.JevMs, "assist_total_ms", p.AssistTotalMs)
		writeJSON(w, http.StatusOK, p)
		return
	}
	if !s.assist.allowRequest() {
		p := fallbackParams("assist_rate_limited")
		p.AssistTotalMs = time.Since(handlerStart).Milliseconds()
		assistLog().Warn("assist fallback: teto de requisições por minuto atingido",
			"reason", "assist_rate_limited", "limit", s.assist.rateLimit,
			"jev_ms", p.JevMs, "assist_total_ms", p.AssistTotalMs)
		writeJSON(w, http.StatusOK, p)
		return
	}

	cacheKey := s.assist.cacheKey(req)
	if params, ok := s.assist.cacheGet(cacheKey); ok {
		params.Cached = true
		params.AssistTotalMs = time.Since(handlerStart).Milliseconds()
		assistLog().Info("assist cache: resposta do Jev reutilizada",
			"source", "typesafe", "cached", true,
			"pacing_level", params.PacingLevel, "confidence", params.Confidence,
			"jev_ms", params.JevMs, "assist_total_ms", params.AssistTotalMs)
		writeJSON(w, http.StatusOK, params)
		return
	}

	params, ok := s.assist.askTypesafe(r.Context(), req)
	if !ok {
		// Preserva a métrica quando o Jev FOI consultado (ex.: confiança
		// abaixo do piso): askTypesafe devolve o fallback com JevMs
		// preenchido. Só fabrica um fallback "assist_unavailable" zerado
		// quando nada voltou (rede/transitório sem resposta).
		if params.JevMs == 0 && params.PageState == "" {
			params = fallbackParams("assist_unavailable")
		}
		if params.Source == "" {
			params.Source = "fallback"
		}
	}
	params.AssistTotalMs = time.Since(handlerStart).Milliseconds()
	// Cache SOMENTE de resposta do Jev: cachear fallback congelaria o modo
	// degradado por 10min (a automação rodaria cega exatamente quando o
	// assist voltasse).
	if params.Source == "typesafe" {
		s.assist.cacheSet(cacheKey, params)
	}
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
	if a.rateSeen >= a.rateLimit {
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
	Type         string         `json:"type"`
	Instructions string         `json:"instructions,omitempty"`
	Criteria     map[string]any `json:"criteria,omitempty"`
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

	// Contrato REAL validado contra o openapi.json de api.typesafe.ai
	// (GET /openapi.json, 23/09/2026): questions >= 1 (minProperties), e o
	// criteria de choice é OBJETO {nome: descricao} — lista era rejeitada
	// com 422. ChoiceAnswer exige choice+confidence+probabilities+type.
	questions := map[string]typesafeQuestion{
		"page_state": {
			Type:         "choice",
			Instructions: "Classifique o estado atual da página do LinkedIn a partir dos seletores disponíveis.",
			Criteria: map[string]any{
				"message_box_open":  "Caixa de mensagem aberta",
				"profile_page":      "Página de perfil",
				"conversation_open": "Conversa aberta",
				"error_or_blocked":  "Erro ou bloqueio do LinkedIn",
				"unknown":           "Estado desconhecido",
			},
		},
		"selector": {
			Type:         "choice",
			Instructions: "Qual seletor CSS é o alvo correto da ação agora? Responda exatamente um dos seletores listados.",
			Criteria:     normalizeSelectors(req.Selectors),
		},
		"pacing_level": {
			Type:         "choice",
			Instructions: "Defina o nível de ritmo humano desta execução de outreach (decisão do Jev, aplicada à digitação e cliques).",
			Criteria: map[string]any{
				"conservative": "Ritmo lento e pausado, o mais humano",
				"moderate":     "Ritmo equilibrado",
				"energetic":    "Ritmo mais ritmado",
			},
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
	var jevMs int64 // soma do HTTP puro à Typesafe (todos os attempts)
	for attempt := 0; attempt <= assistMaxRetries; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.apiURL, bytes.NewReader(body))
		if err != nil {
			return HumanizeParams{}, false
		}
		httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)
		httpReq.Header.Set("Content-Type", "application/json")

		callStart := time.Now()
		resp, err := a.client.Do(httpReq)
		jevMs += time.Since(callStart).Milliseconds()
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

	// DECISÃO DO JEV: o pacing_level escolhido define o perfil numérico
	// da execução. A confiança usada é a DA DECISÃO (pacing_level) — não o
	// mínimo entre todas as respostas: page_state/selector com confiança
	// baixa não podem vetar uma decisão de ritmo que o Jev tomou com
	// confiança própria. O piso aplica-se ao pacing_level.
	pacing := ""
	pacingConf := 1.0
	if ans, ok := parsed.Answers["pacing_level"]; ok && ans.Choice != "" {
		pacing = strings.ToLower(ans.Choice)
		pacingConf = ans.Confidence
	} else {
		assistLog().Warn("assist fallback: Jev não decidiu o pacing_level",
			"source", "typesafe", "reason", "pacing_level_missing")
		return fallbackParams("assist_no_pacing_decision"), false
	}
	params.PacingLevel = pacing
	applyPacingProfile(&params, pacing)

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
	params.JevMs = jevMs
	if pacingConf < a.floor {
		// Confiança abaixo do piso (mesma regra do AGENTS.md p/ o Jev):
		// não agir sobre a resposta — fallback honesto.
		assistLog().Warn("assist fallback: confiança do Jev abaixo do piso",
			"source", "typesafe", "pacing_level", pacing,
			"confidence", pacingConf, "floor", a.floor, "jev_ms", jevMs)
		fb := fallbackParams("assist_low_confidence")
		fb.JevMs = jevMs // o Jev FOI consultado (gastou ms), só não decidiu
		return fb, false
	}
	assistLog().Info("assist Jev: pacing decidido para a execução",
		"source", "typesafe", "pacing_level", pacing,
		"page_state", params.PageState, "confidence", pacingConf,
		"click_delay_ms", params.ClickDelayMs, "jev_ms", jevMs)
	return params, true
	}
	// askTypesafe caiu no esgotamento das tentativas (rede/transitório):
	// fallback zerado com o motivo registrado no log — visível em api.log.
	// JevMs acumulado entra no fallback para auditoria (tentativas gastaram ms).
	assistLog().Warn("assist fallback: Typesafe indisponível após tentativas",
		"reason", "assist_unavailable", "last_error", errString(lastErr), "jev_ms", jevMs)
	_ = lastErr
	fb := fallbackParams("assist_unavailable")
	fb.JevMs = jevMs
	return fb, false
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

type httpError string

func (e httpError) Error() string { return string(e) }

func errHTTP(msg string) error { return httpError(msg) }

// normalizeSelectors devolve criteria de choice no formato do spec
// ({seletor: descricao}) — no máximo 6 alvos para a decisão do Jev.
func normalizeSelectors(selectors []string) map[string]any {
	out := map[string]any{}
	for _, sel := range selectors {
		sel = strings.TrimSpace(sel)
		if sel == "" || len(out) >= 6 {
			continue
		}
		out[sel] = "Seletor candidato ao alvo da ação"
	}
	if len(out) == 0 {
		out["none"] = "Nenhum seletor disponível"
	}
	return out
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// pacingProfiles: perfis numéricos decididos pelo Jev (pacing_level).
// conservative = mais lento/pausado; energetic = mais ritmado. Todos os
// valores recebem jitter humano em applyPacingProfile.
var pacingProfiles = map[string]struct {
	clickDelay [2]int
	cps        [2]float64
	pauseEvery [2]int
	pauseMs    [2]int
}{
	"conservative": {clickDelay: [2]int{1400, 2600}, cps: [2]float64{3.5, 6.0}, pauseEvery: [2]int{12, 26}, pauseMs: [2]int{700, 1800}},
	"moderate":     {clickDelay: [2]int{900, 1800}, cps: [2]float64{5.0, 8.5}, pauseEvery: [2]int{18, 36}, pauseMs: [2]int{450, 1200}},
	"energetic":    {clickDelay: [2]int{600, 1300}, cps: [2]float64{7.0, 11.0}, pauseEvery: [2]int{25, 48}, pauseMs: [2]int{300, 900}},
}

// applyPacingProfile aplica o perfil decidido pelo Jev com jitter; sem
// decisão válida, mantém o perfil moderado (curva humana padrão).
func applyPacingProfile(params *HumanizeParams, level string) {
	prof, ok := pacingProfiles[level]
	if !ok {
		prof = pacingProfiles["moderate"]
	}
	params.ClickDelayMs = randInt(prof.clickDelay[0], prof.clickDelay[1])
	params.TypeCpsMin = prof.cps[0] + rand.Float64()*0.5
	params.TypeCpsMax = prof.cps[1] + rand.Float64()*0.5
	params.PauseEveryMin = randInt(prof.pauseEvery[0], prof.pauseEvery[0]+6)
	params.PauseEveryMax = randInt(prof.pauseEvery[1], prof.pauseEvery[1]+10)
	params.PauseMsMin = randInt(prof.pauseMs[0], prof.pauseMs[0]+150)
	params.PauseMsMax = randInt(prof.pauseMs[1], prof.pauseMs[1]+300)
	params.ScrollDwellMs = randInt(500, 1300)
	params.MouseStepsMin = randInt(14, 22)
	params.MouseStepsMax = randInt(30, 44)
}

package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
)

// Rate limit HTTP por janela fixa no Redis (INCR + EXPIRE) — protege as
// rotas públicas sensíveis (login, pareamento) contra brute-force e abuso,
// sem dependência nova (reusa o client de platform/redis).
//
// Sem Redis (nil ou fora do ar): FAIL-OPEN com log — disponibilidade local
// primeiro; o teto duro de segurança volta quando o Redis retorna.

type rlBucket struct {
	name     string
	limit    int
	window   time.Duration
	keyExtra func(r *http.Request) string // dimensão extra (ex.: user id autenticado)
}

var (
	bucketGlobal      = rlBucket{name: "global", limit: 120, window: time.Minute}
	bucketLogin       = rlBucket{name: "login", limit: 10, window: time.Minute}
	bucketPair        = rlBucket{name: "pair", limit: 5, window: 10 * time.Minute}
	bucketPairingCode = rlBucket{name: "pairing-code", limit: 5, window: time.Hour}
	bucketHeartbeat   = rlBucket{name: "heartbeat", limit: 30, window: time.Minute}
)

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimitMiddleware checa o bucket e responde 429 com Retry-After quando
// estourado. Sem redisClient → pass-through.
func (s *Server) rateLimitMiddleware(bucket rlBucket) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.redisClient == nil {
				next.ServeHTTP(w, r)
				return
			}

			key := fmt.Sprintf("rl:%s:%s", bucket.name, clientIP(r))
			if bucket.keyExtra != nil {
				key += ":" + bucket.keyExtra(r)
			}
			windowKey := key + ":" + strconv.FormatInt(time.Now().Unix()/int64(bucket.window.Seconds()), 10)

			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()

			count, err := s.redisClient.Rdb.Incr(ctx, windowKey).Result()
			if err != nil {
				// FAIL-OPEN: Redis caiu não derruba a API.
				logger.New("warn").Warn("rate limit redis indisponível — fail-open", "bucket", bucket.name, "error", err)
				next.ServeHTTP(w, r)
				return
			}
			if count == 1 {
				s.redisClient.Rdb.Expire(ctx, windowKey, bucket.window)
			}
			if count > int64(bucket.limit) {
				retryAfter := int(bucket.window.Seconds())
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeAPIError(w, http.StatusTooManyRequests, "RATE_LIMITED",
					"muitas requisições — tente novamente mais tarde", map[string]any{
						"bucket": bucket.name,
						"limit":  bucket.limit,
						"window": bucket.window.String(),
					})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

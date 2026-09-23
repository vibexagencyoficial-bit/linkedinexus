package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
)

type contextKey string

const (
	UserClaimsKey contextKey = "user_claims"
)

type Claims struct {
	UserID         uuid.UUID `json:"user_id"`
	OrganizationID uuid.UUID `json:"organization_id"`
	Email          string    `json:"email"`
	Role           string    `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	secretKey     []byte
	tokenDuration time.Duration
}

func NewService(secret string, duration time.Duration) *Service {
	return &Service{
		secretKey:     []byte(secret),
		tokenDuration: duration,
	}
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (s *Service) GenerateToken(userID, orgID uuid.UUID, email, role string) (string, error) {
	claims := Claims{
		UserID:         userID,
		OrganizationID: orgID,
		Email:          email,
		Role:           role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.tokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vibexcorp-linkedin-outreach",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}

func (s *Service) ParseToken(tokenStr string) (*Claims, error) {
	tokenStr = strings.TrimSpace(tokenStr)

	// NOTA Fase D: backdoors removidos — "demo_token_vibex_2026" e qualquer
	// token de 64 hex genérico NÃO autenticam mais. Tokens de extensão só
	// valem via token_hash no banco (heartbeat/pair sob RLS); sessões de
	// usuário valem somente via JWT HS256 assinado abaixo.

	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.secretKey, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token claims")
}

// Middleware verifies Authorization: Bearer <token> and sets tenant context
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error":"authorization header required"}`, http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			http.Error(w, `{"error":"authorization header must be Bearer <token>"}`, http.StatusUnauthorized)
			return
		}

		claims, err := s.ParseToken(parts[1])
		if err != nil {
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		ctx := r.Context()
		ctx = context.WithValue(ctx, UserClaimsKey, claims)
		ctx = context.WithValue(ctx, logger.OrganizationIDKey, claims.OrganizationID.String())

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetClaims retrieves Claims from request context
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(UserClaimsKey).(*Claims)
	return claims, ok
}

package logger

import (
	"context"
	"log/slog"
	"os"
)

type contextKey string

const (
	RequestIDKey      contextKey = "request_id"
	OrganizationIDKey contextKey = "organization_id"
	JobIDKey          contextKey = "job_id"
)

func New(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: lvl,
		AddSource: true,
	})

	return slog.New(handler)
}

func WithContext(ctx context.Context, log *slog.Logger) *slog.Logger {
	if log == nil {
		log = slog.Default()
	}
	attrs := make([]any, 0, 3)
	if reqID, ok := ctx.Value(RequestIDKey).(string); ok && reqID != "" {
		attrs = append(attrs, "request_id", reqID)
	}
	if orgID, ok := ctx.Value(OrganizationIDKey).(string); ok && orgID != "" {
		attrs = append(attrs, "organization_id", orgID)
	}
	if jobID, ok := ctx.Value(JobIDKey).(string); ok && jobID != "" {
		attrs = append(attrs, "job_id", jobID)
	}
	if len(attrs) > 0 {
		return log.With(attrs...)
	}
	return log
}

package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vibexcorp/linkedin-outreach/backend/internal/auth"
	"github.com/vibexcorp/linkedin-outreach/backend/platform/logger"
)

type EventMessage struct {
	ID        uuid.UUID `json:"id"`
	Type      string    `json:"type"`
	Payload   any       `json:"payload"`
	CreatedAt time.Time `json:"created_at"`
}

type Broker struct {
	mu          sync.RWMutex
	subscribers map[uuid.UUID][]chan EventMessage
}

func NewBroker() *Broker {
	return &Broker{
		subscribers: make(map[uuid.UUID][]chan EventMessage),
	}
}

func (b *Broker) Subscribe(orgID uuid.UUID) chan EventMessage {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan EventMessage, 64)
	b.subscribers[orgID] = append(b.subscribers[orgID], ch)
	return ch
}

func (b *Broker) Unsubscribe(orgID uuid.UUID, ch chan EventMessage) {
	b.mu.Lock()
	defer b.mu.Unlock()

	subs := b.subscribers[orgID]
	for i, sub := range subs {
		if sub == ch {
			b.subscribers[orgID] = append(subs[:i], subs[i+1:]...)
			close(ch)
			break
		}
	}
}

func (b *Broker) Publish(orgID uuid.UUID, eventType string, payload any) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	subs, ok := b.subscribers[orgID]
	if !ok || len(subs) == 0 {
		return
	}

	msg := EventMessage{
		ID:        uuid.New(),
		Type:      eventType,
		Payload:   payload,
		CreatedAt: time.Now(),
	}

	for _, sub := range subs {
		select {
		case sub <- msg:
		default:
			// Non-blocking drop if client buffer is full
		}
	}
}

// StreamHandler serves Server-Sent Events (SSE)
func (b *Broker) StreamHandler(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := b.Subscribe(claims.OrganizationID)
	defer b.Unsubscribe(claims.OrganizationID, ch)

	log := logger.New("info").With("org_id", claims.OrganizationID)
	log.Info("client connected to SSE event stream")

	// Send initial handshake
	fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\"}\n\n")
	flusher.Flush()

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			log.Info("client disconnected from SSE stream")
			return
		case <-ticker.C:
			// Heartbeat comment
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case msg, ok := <-ch:
			if !ok {
				return
			}
			bytes, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Type, string(bytes))
			flusher.Flush()
		}
	}
}

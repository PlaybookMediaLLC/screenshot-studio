package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
)

type Store interface {
	Ping(context.Context) error
	CreateConnection(context.Context, publishing.Actor, publishing.CreateConnectionInput) (*ent.ChannelConnection, error)
	ListConnections(context.Context, string) ([]*ent.ChannelConnection, error)
	CreateScheduledPost(context.Context, publishing.Actor, publishing.CreateScheduledPostInput) (publishing.CreateScheduledPostResult, error)
	ListScheduledPosts(context.Context, string, int) ([]*ent.ScheduledPost, error)
	CancelScheduledPost(context.Context, publishing.Actor, string) (*ent.ScheduledPost, error)
}

type WorkflowScheduler interface {
	Cancel(context.Context, string) error
	Ping(context.Context) error
	Start(context.Context, temporalpublishing.ScheduleInput) error
}

type Server struct {
	scheduler    WorkflowScheduler
	serviceToken string
	store        Store
}

func New(store Store, scheduler WorkflowScheduler, serviceToken string) http.Handler {
	s := &Server{store: store, scheduler: scheduler, serviceToken: serviceToken}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.Handle("GET /v1/channel-connections", s.authenticate(http.HandlerFunc(s.listConnections)))
	mux.Handle("POST /v1/channel-connections", s.authenticate(http.HandlerFunc(s.createConnection)))
	mux.Handle("GET /v1/scheduled-posts", s.authenticate(http.HandlerFunc(s.listScheduledPosts)))
	mux.Handle("POST /v1/scheduled-posts", s.authenticate(http.HandlerFunc(s.createScheduledPost)))
	mux.Handle("POST /v1/scheduled-posts/{id}/cancel", s.authenticate(http.HandlerFunc(s.cancelScheduledPost)))
	return requestLogging(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "publishing-backend"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database is unavailable")
		return
	}
	if err := s.scheduler.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Temporal is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.serviceToken == "" {
			writeError(w, http.StatusServiceUnavailable, "service authentication is not configured")
			return
		}
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(s.serviceToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if r.Header.Get("X-Organization-ID") == "" {
			writeError(w, http.StatusBadRequest, "X-Organization-ID is required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type connectionRequest struct {
	ExternalAccountID string         `json:"externalAccountId"`
	Platform          string         `json:"platform"`
	ProviderSettings  map[string]any `json:"providerSettings"`
	SecretReference   string         `json:"secretReference"`
}

func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(w, r, true)
	if !ok {
		return
	}
	var input connectionRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	input.ExternalAccountID = strings.TrimSpace(input.ExternalAccountID)
	input.Platform = strings.ToLower(strings.TrimSpace(input.Platform))
	input.SecretReference = strings.TrimSpace(input.SecretReference)
	if input.Platform == "" {
		input.Platform = "x"
	}
	if input.SecretReference == "" {
		input.SecretReference = "POSTIZ_API_KEY"
	}
	if input.ProviderSettings == nil {
		input.ProviderSettings = map[string]any{}
	}
	if input.ExternalAccountID == "" || len([]rune(input.ExternalAccountID)) > 160 ||
		len(input.Platform) > 64 || !platformPattern.MatchString(input.Platform) ||
		!publishing.IsSecretReference(input.SecretReference) {
		writeError(w, http.StatusBadRequest, "externalAccountId and a valid Postiz secretReference are required")
		return
	}
	connection, err := s.store.CreateConnection(r.Context(), actor, publishing.CreateConnectionInput{
		ExternalAccountID: input.ExternalAccountID,
		Platform:          input.Platform,
		ProviderSettings:  input.ProviderSettings,
		SecretReference:   input.SecretReference,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, connectionResponse(connection))
}

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	organizationID := r.Header.Get("X-Organization-ID")
	connections, err := s.store.ListConnections(r.Context(), organizationID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items := make([]any, 0, len(connections))
	for _, connection := range connections {
		items = append(items, connectionResponse(connection))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type scheduledPostRequest struct {
	Caption             string    `json:"caption"`
	ChannelConnectionID string    `json:"channelConnectionId"`
	IdempotencyKey      string    `json:"idempotencyKey"`
	ScheduledFor        time.Time `json:"scheduledFor"`
	VariantID           string    `json:"variantId"`
}

func (s *Server) createScheduledPost(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(w, r, true)
	if !ok {
		return
	}
	var input scheduledPostRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	input.Caption = strings.TrimSpace(input.Caption)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Caption == "" || len([]rune(input.Caption)) > 3000 || input.ChannelConnectionID == "" || input.VariantID == "" || input.IdempotencyKey == "" || input.ScheduledFor.IsZero() {
		writeError(w, http.StatusBadRequest, "caption, channelConnectionId, idempotencyKey, scheduledFor, and variantId are required")
		return
	}
	if len(input.IdempotencyKey) > 128 {
		writeError(w, http.StatusBadRequest, "idempotencyKey must not exceed 128 characters")
		return
	}
	if !input.ScheduledFor.After(time.Now()) {
		writeError(w, http.StatusBadRequest, "scheduledFor must be in the future")
		return
	}
	result, err := s.store.CreateScheduledPost(r.Context(), actor, publishing.CreateScheduledPostInput{
		Caption: input.Caption, ChannelConnectionID: input.ChannelConnectionID,
		IdempotencyKey: input.IdempotencyKey, ScheduledFor: input.ScheduledFor, VariantID: input.VariantID,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.scheduler.Start(r.Context(), temporalpublishing.ScheduleInput{
		OrganizationID: result.Post.OrganizationID,
		PostID:         result.Post.ID,
		ScheduledFor:   result.Post.ScheduledFor,
	}); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not start publishing workflow")
		return
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"created": result.Created, "scheduledPost": scheduledPostResponse(result.Post)})
}

func (s *Server) listScheduledPosts(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	posts, err := s.store.ListScheduledPosts(r.Context(), r.Header.Get("X-Organization-ID"), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items := make([]any, 0, len(posts))
	for _, post := range posts {
		items = append(items, scheduledPostResponse(post))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

var platformPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

func (s *Server) cancelScheduledPost(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(w, r, true)
	if !ok {
		return
	}
	post, err := s.store.CancelScheduledPost(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.scheduler.Cancel(r.Context(), post.ID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not cancel publishing workflow")
		return
	}
	writeJSON(w, http.StatusOK, scheduledPostResponse(post))
}

func actorFromRequest(w http.ResponseWriter, r *http.Request, requireUser bool) (publishing.Actor, bool) {
	userID := r.Header.Get("X-User-ID")
	if requireUser && userID == "" {
		writeError(w, http.StatusBadRequest, "X-User-ID is required")
		return publishing.Actor{}, false
	}
	requestID := r.Header.Get("X-Request-ID")
	if requestID == "" {
		requestID = fmt.Sprintf("backend-%d", time.Now().UnixNano())
	}
	return publishing.Actor{
		Display: r.Header.Get("X-Actor-Display"), Organization: r.Header.Get("X-Organization-ID"),
		RequestID: requestID, Type: "USER", UserID: userID,
	}, true
}

func connectionResponse(connection *ent.ChannelConnection) map[string]any {
	return map[string]any{
		"id": connection.ID, "externalAccountId": connection.ExternalAccountID,
		"platform": connection.Platform, "provider": connection.Provider,
		"providerSettings": connection.ProviderSettings, "status": connection.Status,
		"createdAt": connection.CreatedAt, "updatedAt": connection.UpdatedAt,
	}
}

func scheduledPostResponse(post *ent.ScheduledPost) map[string]any {
	response := map[string]any{
		"id": post.ID, "caption": post.Caption, "channelConnectionId": post.ChannelConnectionID,
		"createdAt": post.CreatedAt, "scheduledFor": post.ScheduledFor, "status": post.Status,
		"updatedAt": post.UpdatedAt, "variantId": post.VariantID,
	}
	if connection, err := post.Edges.ChannelConnectionOrErr(); err == nil {
		response["channelConnection"] = map[string]any{
			"externalAccountId": connection.ExternalAccountID,
			"platform":          connection.Platform,
			"provider":          connection.Provider,
		}
	}
	return response
}

func decodeJSON(r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, publishing.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, publishing.ErrConflict), errors.Is(err, publishing.ErrInvalidState):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, publishing.ErrNotEligible):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("method=%s path=%s duration=%s\n", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

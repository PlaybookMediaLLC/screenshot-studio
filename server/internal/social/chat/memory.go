package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

// lastMessages is Mastra's default memory history size.
const lastMessages = 10

// Memory is Mastra's Memory over the PostgresStore tables (mastra_threads,
// mastra_messages, mastra_resources), reading and writing rows in Mastra's
// format so threads stay shared with the TypeScript backend.
type Memory struct {
	client *ent.Client
	// working memory updates are serialized per resource, like Mastra's mutex
	mu sync.Mutex
}

func NewMemory(client *ent.Client) *Memory { return &Memory{client: client} }

// JSDate marshals like a JavaScript Date.
type JSDate time.Time

func (d JSDate) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Time(d).UTC().Format("2006-01-02T15:04:05.000Z"))
}

type Thread struct {
	ID         string         `json:"id"`
	ResourceID string         `json:"resourceId"`
	Title      string         `json:"title"`
	Metadata   map[string]any `json:"metadata"`
	CreatedAt  JSDate         `json:"createdAt"`
	UpdatedAt  JSDate         `json:"updatedAt"`
}

// DBMessage is a MastraDBMessage. Content is the stored format-2 content,
// kept verbatim so parts this port does not produce survive a round trip.
type DBMessage struct {
	ID         string          `json:"id"`
	Role       string          `json:"role"`
	CreatedAt  JSDate          `json:"createdAt"`
	ThreadID   string          `json:"threadId"`
	ResourceID string          `json:"resourceId"`
	Content    json.RawMessage `json:"content"`
	// Type is only set for rows that are not "v2".
	Type string `json:"type,omitempty"`
}

// MessageContent is the format-2 content this port writes and reads.
type MessageContent struct {
	Format  int    `json:"format"`
	Parts   []Part `json:"parts"`
	Content string `json:"content,omitempty"`
}

type Part struct {
	Type           string          `json:"type"`
	Text           string          `json:"text,omitempty"`
	ToolInvocation *ToolInvocation `json:"toolInvocation,omitempty"`
}

type ToolInvocation struct {
	State      string `json:"state"` // call | result
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Args       any    `json:"args"`
	Result     any    `json:"result,omitempty"`
}

func scanTime(primary sql.NullTime, fallback time.Time) time.Time {
	if primary.Valid {
		return primary.Time
	}
	return fallback
}

// GetThreadByID returns nil when the thread does not exist.
func (m *Memory) GetThreadByID(ctx context.Context, threadID string) (*Thread, error) {
	rows, err := m.client.QueryContext(ctx, `SELECT id, "resourceId", title, metadata, "createdAt", "createdAtZ", "updatedAt", "updatedAtZ" FROM mastra_threads WHERE id = $1`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	threads, err := scanThreads(rows)
	if err != nil || len(threads) == 0 {
		return nil, err
	}
	return threads[0], nil
}

func scanThreads(rows *sql.Rows) ([]*Thread, error) {
	out := []*Thread{}
	for rows.Next() {
		var t Thread
		var metadata sql.NullString
		var createdAt, updatedAt time.Time
		var createdAtZ, updatedAtZ sql.NullTime
		if err := rows.Scan(&t.ID, &t.ResourceID, &t.Title, &metadata, &createdAt, &createdAtZ, &updatedAt, &updatedAtZ); err != nil {
			return nil, err
		}
		if metadata.Valid && metadata.String != "" {
			_ = json.Unmarshal([]byte(metadata.String), &t.Metadata)
		}
		t.CreatedAt = JSDate(scanTime(createdAtZ, createdAt))
		t.UpdatedAt = JSDate(scanTime(updatedAtZ, updatedAt))
		out = append(out, &t)
	}
	return out, rows.Err()
}

// SaveThread is PostgresStore.saveThread (an upsert).
func (m *Memory) SaveThread(ctx context.Context, t *Thread) error {
	var metadata any
	if len(t.Metadata) > 0 {
		data, _ := json.Marshal(t.Metadata)
		metadata = string(data)
	}
	createdAt, updatedAt := time.Time(t.CreatedAt).UTC(), time.Time(t.UpdatedAt).UTC()
	_, err := m.client.ExecContext(ctx, `INSERT INTO mastra_threads (id, "resourceId", title, metadata, "createdAt", "createdAtZ", "updatedAt", "updatedAtZ")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET
  "resourceId" = EXCLUDED."resourceId",
  title = EXCLUDED.title,
  metadata = EXCLUDED.metadata,
  "createdAt" = EXCLUDED."createdAt",
  "createdAtZ" = EXCLUDED."createdAtZ",
  "updatedAt" = EXCLUDED."updatedAt",
  "updatedAtZ" = EXCLUDED."updatedAtZ"`,
		t.ID, t.ResourceID, t.Title, metadata, createdAt, createdAt, updatedAt, updatedAt)
	return err
}

// CreateThread is MastraMemory.createThread with an empty title.
func (m *Memory) CreateThread(ctx context.Context, threadID, resourceID string) (*Thread, error) {
	now := JSDate(time.Now())
	t := &Thread{ID: threadID, ResourceID: resourceID, Title: "", CreatedAt: now, UpdatedAt: now}
	return t, m.SaveThread(ctx, t)
}

// UpdateThreadTitle is updateThread({ id, title }).
func (m *Memory) UpdateThreadTitle(ctx context.Context, threadID, title string) error {
	now := time.Now().UTC()
	_, err := m.client.ExecContext(ctx, `UPDATE mastra_threads SET title = $1, "updatedAt" = $2, "updatedAtZ" = $3 WHERE id = $4`, title, now, now, threadID)
	return err
}

// ThreadSummary is one entry of the /copilot/list answer.
type ThreadSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ThreadList is the /copilot/list answer.
type ThreadList struct {
	Threads []ThreadSummary `json:"threads"`
}

// ListThreads is memory.listThreads({ filter: { resourceId }, perPage:
// 100000, page: 0, orderBy: createdAt DESC }) mapped to { threads: [{ id,
// title }] } as the copilot controller answers it.
func (m *Memory) ListThreads(ctx context.Context, resourceID string) (*ThreadList, error) {
	rows, err := m.client.QueryContext(ctx, `SELECT id, "resourceId", title, metadata, "createdAt", "createdAtZ", "updatedAt", "updatedAtZ" FROM mastra_threads WHERE "resourceId" = $1 ORDER BY COALESCE("createdAtZ", "createdAt" AT TIME ZONE 'UTC') DESC, "id" DESC LIMIT 100000 OFFSET 0`, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	threads, err := scanThreads(rows)
	if err != nil {
		return nil, err
	}
	out := &ThreadList{Threads: []ThreadSummary{}}
	for _, t := range threads {
		out.Threads = append(out.Threads, ThreadSummary{ID: t.ID, Title: t.Title})
	}
	return out, nil
}

// RecallResult is memory.recall's answer.
type RecallResult struct {
	Messages []DBMessage `json:"messages"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PerPage  int         `json:"perPage"`
	HasMore  bool        `json:"hasMore"`
}

// Recall is memory.recall({ resourceId, threadId }): the last `lastMessages`
// messages of the thread, oldest first. It fails like Mastra when the thread
// is missing or belongs to another resource.
func (m *Memory) Recall(ctx context.Context, resourceID, threadID string) (*RecallResult, error) {
	return m.recall(ctx, resourceID, threadID, lastMessages)
}

func (m *Memory) recall(ctx context.Context, resourceID, threadID string, perPage int) (*RecallResult, error) {
	thread, err := m.GetThreadByID(ctx, threadID)
	if err != nil {
		return nil, err
	}
	if thread == nil {
		return nil, fmt.Errorf("No thread found with id %s", threadID)
	}
	if thread.ResourceID != resourceID {
		return nil, fmt.Errorf("Thread with id %s is for resource with id %s but resource %s was queried.", threadID, thread.ResourceID, resourceID)
	}
	var total int
	if err := m.queryRow(ctx, `SELECT COUNT(*) FROM mastra_messages WHERE thread_id = $1 AND "resourceId" = $2`, []any{threadID, resourceID}, &total); err != nil {
		return nil, err
	}
	query := `SELECT id, content, role, type, "createdAt", "createdAtZ", thread_id, "resourceId" FROM mastra_messages WHERE thread_id = $1 AND "resourceId" = $2 ORDER BY "createdAt" DESC, "id" DESC`
	args := []any{threadID, resourceID}
	if perPage > 0 {
		query += ` LIMIT $3 OFFSET 0`
		args = append(args, perPage)
	}
	messages, err := m.queryMessages(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	slices.Reverse(messages)
	return &RecallResult{Messages: messages, Total: total, Page: 0, PerPage: perPage, HasMore: perPage > 0 && perPage < total}, nil
}

func (m *Memory) queryRow(ctx context.Context, query string, args []any, dest ...any) error {
	rows, err := m.client.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return err
		}
		return sql.ErrNoRows
	}
	return rows.Scan(dest...)
}

func (m *Memory) queryMessages(ctx context.Context, query string, args ...any) ([]DBMessage, error) {
	rows, err := m.client.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DBMessage{}
	for rows.Next() {
		var msg DBMessage
		var content, kind string
		var createdAt time.Time
		var createdAtZ sql.NullTime
		var resourceID sql.NullString
		if err := rows.Scan(&msg.ID, &content, &msg.Role, &kind, &createdAt, &createdAtZ, &msg.ThreadID, &resourceID); err != nil {
			return nil, err
		}
		msg.ResourceID = resourceID.String
		msg.CreatedAt = JSDate(scanTime(createdAtZ, createdAt))
		if json.Valid([]byte(content)) {
			msg.Content = json.RawMessage(content)
		} else {
			msg.Content, _ = json.Marshal(content)
		}
		if kind != "v2" {
			msg.Type = kind
		}
		out = append(out, msg)
	}
	return out, rows.Err()
}

// messagesByID returns the stored messages among ids.
func (m *Memory) messagesByID(ctx context.Context, threadID string, ids []string) (map[string]DBMessage, error) {
	out := map[string]DBMessage{}
	if len(ids) == 0 {
		return out, nil
	}
	list, err := m.queryMessages(ctx, `SELECT id, content, role, type, "createdAt", "createdAtZ", thread_id, "resourceId" FROM mastra_messages WHERE thread_id = $1 AND id = ANY($2)`, threadID, ids)
	if err != nil {
		return nil, err
	}
	for _, msg := range list {
		out[msg.ID] = msg
	}
	return out, nil
}

// SaveMessages is PostgresStore.saveMessages: upsert by id, then touch the
// thread's updatedAt.
func (m *Memory) SaveMessages(ctx context.Context, messages []DBMessage) error {
	if len(messages) == 0 {
		return nil
	}
	tx, err := m.client.Tx(ctx)
	if err != nil {
		return err
	}
	threads := map[string]bool{}
	for _, msg := range messages {
		kind := msg.Type
		if kind == "" {
			kind = "v2"
		}
		createdAt := time.Time(msg.CreatedAt).UTC()
		if _, err := tx.ExecContext(ctx, `INSERT INTO mastra_messages (id, thread_id, content, "createdAt", "createdAtZ", role, type, "resourceId")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET
  thread_id = EXCLUDED.thread_id,
  content = EXCLUDED.content,
  role = EXCLUDED.role,
  type = EXCLUDED.type,
  "resourceId" = EXCLUDED."resourceId"`,
			msg.ID, msg.ThreadID, string(msg.Content), createdAt, createdAt, msg.Role, kind, msg.ResourceID); err != nil {
			_ = tx.Rollback()
			return err
		}
		threads[msg.ThreadID] = true
	}
	now := time.Now().UTC()
	for id := range threads {
		if _, err := tx.ExecContext(ctx, `UPDATE mastra_threads SET "updatedAt" = $1, "updatedAtZ" = $2 WHERE id = $3`, now, now, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// GetWorkingMemory returns the resource-scoped working memory, "" when none.
func (m *Memory) GetWorkingMemory(ctx context.Context, resourceID string) (string, error) {
	var wm sql.NullString
	err := m.queryRow(ctx, `SELECT "workingMemory" FROM mastra_resources WHERE id = $1`, []any{resourceID}, &wm)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return wm.String, err
}

// UpdateWorkingMemory is PostgresStore.updateResource({ resourceId,
// workingMemory }), creating the resource when it does not exist.
func (m *Memory) UpdateWorkingMemory(ctx context.Context, resourceID, workingMemory string) error {
	now := time.Now().UTC()
	_, err := m.client.ExecContext(ctx, `INSERT INTO mastra_resources (id, "workingMemory", metadata, "createdAt", "createdAtZ", "updatedAt", "updatedAtZ")
VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET "workingMemory" = EXCLUDED."workingMemory", "updatedAt" = EXCLUDED."updatedAt", "updatedAtZ" = EXCLUDED."updatedAtZ"`, resourceID, workingMemory, now, now, now, now)
	return err
}

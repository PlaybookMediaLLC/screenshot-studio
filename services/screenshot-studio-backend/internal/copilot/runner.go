package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
)

// This file ports the runtime's InMemoryAgentRunner (v2/runtime/runner/
// in-memory), the AbstractAgent.runAgent event pipeline it drives
// (@ag-ui/client transformChunks) and createSseEventResponse
// (v2/runtime/handlers/shared/sse-response).

const (
	maxThreads       = 1000
	maxRunsPerThread = 100
)

// thread is an InMemoryEventStore. The store is process-wide and shared by
// both endpoints, like the runtime's ɵGLOBAL_STORE.
type thread struct {
	running       bool
	stopRequested bool
	cancel        context.CancelFunc
	current       *eventLog
	runs          [][]json.RawMessage
	touched       uint64
}

var threads = struct {
	sync.Mutex
	m     map[string]*thread
	clock uint64
}{m: map[string]*thread{}}

// getOrCreate returns the thread, evicting the least recently used idle thread
// past maxThreads. Callers hold threads.Mutex.
// ponytail: O(n) LRU scan and no 512MB byte budget; add both if thread volume grows.
func getOrCreate(id string) *thread {
	threads.clock++
	if t, ok := threads.m[id]; ok {
		t.touched = threads.clock
		return t
	}
	t := &thread{touched: threads.clock}
	threads.m[id] = t
	for len(threads.m) > maxThreads {
		victim := ""
		for vid, v := range threads.m {
			if vid != id && !v.running && !v.stopRequested && (victim == "" || v.touched < threads.m[victim].touched) {
				victim = vid
			}
		}
		if victim == "" {
			break
		}
		delete(threads.m, victim)
	}
	return t
}

// eventLog is a ReplaySubject: every reader sees all events from the start.
type eventLog struct {
	mu     sync.Mutex
	events []json.RawMessage
	done   bool
	wake   chan struct{}
}

func newEventLog() *eventLog { return &eventLog{wake: make(chan struct{})} }

func (l *eventLog) push(events ...json.RawMessage) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, events...)
	close(l.wake)
	l.wake = make(chan struct{})
}

func (l *eventLog) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.done = true
	close(l.wake)
}

// read blocks until event i exists; false once the log is closed and drained.
func (l *eventLog) read(ctx context.Context, i int) (json.RawMessage, bool) {
	for {
		l.mu.Lock()
		if i < len(l.events) {
			e := l.events[i]
			l.mu.Unlock()
			return e, true
		}
		if l.done {
			l.mu.Unlock()
			return nil, false
		}
		wake := l.wake
		l.mu.Unlock()
		select {
		case <-wake:
		case <-ctx.Done():
			return nil, false
		}
	}
}

// eventHead is the part of an AG-UI event the runtime inspects.
type eventHead struct {
	Type            string          `json:"type"`
	MessageID       *string         `json:"messageId"`
	ToolCallID      *string         `json:"toolCallId"`
	ToolCallName    *string         `json:"toolCallName"`
	ParentMessageID *string         `json:"parentMessageId"`
	Role            string          `json:"role"`
	Name            *string         `json:"name"`
	Delta           json.RawMessage `json:"delta"`
	SubagentRunID   *string         `json:"subagentRunId"`
	Metadata        json.RawMessage `json:"metadata"`
	Input           json.RawMessage `json:"input"`
}

func head(e json.RawMessage) eventHead {
	var h eventHead
	_ = json.Unmarshal(e, &h)
	return h
}

// streamEvents is createSseEventResponse: 200 text/event-stream with one
// `data:` frame per event, first the prefix, then the log until it closes.
func streamEvents(w http.ResponseWriter, r *http.Request, prefix []json.RawMessage, log *eventLog, skip func(json.RawMessage) bool) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	_ = rc.Flush()
	write := func(e json.RawMessage) bool {
		if _, err := fmt.Fprintf(w, "data: %s\n\n", e); err != nil {
			return false
		}
		_ = rc.Flush()
		return true
	}
	for _, e := range prefix {
		if !write(e) {
			return
		}
	}
	if log == nil {
		return
	}
	for i := 0; ; i++ {
		e, ok := log.read(r.Context(), i)
		if !ok {
			return
		}
		if skip != nil && skip(e) {
			continue
		}
		if !write(e) {
			return
		}
	}
}

// agentInput is prepareRunAgentInput: activity messages are not sent to the
// agent and forwardedProps defaults to {}.
func agentInput(input RunAgentInput) RunAgentInput {
	messages := make([]Message, 0, len(input.Messages))
	for _, m := range input.Messages {
		if m.Role != "activity" {
			messages = append(messages, m)
		}
	}
	input.Messages = messages
	if len(input.ForwardedProps) == 0 || string(input.ForwardedProps) == "null" {
		input.ForwardedProps = json.RawMessage(`{}`)
	}
	return input
}

// pump runs the agent and hands every event, after transformChunks, to emit.
// It returns the interruption message when the run failed.
func pump(ctx context.Context, cancel context.CancelFunc, agent AgentRunner, input RunAgentInput, emit func(json.RawMessage)) *string {
	ch, err := agent.Run(ctx, agentInput(input))
	if err != nil {
		msg := err.Error()
		return &msg
	}
	var tr chunkTransform
	for raw := range ch {
		out, err := tr.next(raw)
		if err != nil {
			cancel()
			go func() {
				for range ch {
				}
			}()
			msg := err.Error()
			return &msg
		}
		for _, e := range out {
			emit(e)
		}
	}
	return nil
}

var errThreadRunning = errors.New("Thread already running")

// runThread is handleRunAgent + InMemoryAgentRunner.run. The agent keeps
// running when the client disconnects; agent/connect can rejoin it.
func runThread(w http.ResponseWriter, r *http.Request, agent AgentRunner, input RunAgentInput) {
	threads.Lock()
	t := getOrCreate(input.ThreadID)
	if t.running || t.stopRequested {
		threads.Unlock()
		// The runner throws inside the SSE factory: the stream opens and closes empty.
		slog.Error("Error running agent:", "err", errThreadRunning)
		streamEvents(w, r, nil, nil, nil)
		return
	}
	historic := historicMessageIDs(t.runs)
	ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
	runLog := newEventLog()
	t.running, t.stopRequested, t.cancel, t.current = true, false, cancel, runLog
	threads.Unlock()

	go func() {
		defer cancel()
		var events []json.RawMessage
		interrupted := pump(ctx, cancel, agent, input, func(e json.RawMessage) {
			e = withRunInput(e, input, historic)
			events = append(events, e)
			runLog.push(e)
		})

		threads.Lock()
		defer threads.Unlock()
		count := len(events)
		appended := finalizeRunEvents(events, t.stopRequested, interrupted)
		runLog.push(appended...)
		events = append(events, appended...)
		if (interrupted == nil || count > 0) && threads.m[input.ThreadID] == t {
			t.runs = append(t.runs, events)
			if len(t.runs) > maxRunsPerThread {
				t.runs = t.runs[len(t.runs)-maxRunsPerThread:]
			}
		}
		t.running, t.stopRequested, t.cancel, t.current = false, false, nil, nil
		runLog.close()
	}()

	streamEvents(w, r, nil, runLog, nil)
}

// connectThread is InMemoryAgentRunner.connect: replay the thread's finished
// runs, then follow the active run, skipping messages already replayed.
// ponytail: history is replayed as recorded, not compactEvents-merged; the client folds it the same way.
func connectThread(w http.ResponseWriter, r *http.Request, threadID string) {
	threads.Lock()
	var prefix []json.RawMessage
	var live *eventLog
	if t, ok := threads.m[threadID]; ok {
		threads.clock++
		t.touched = threads.clock
		for _, run := range t.runs {
			prefix = append(prefix, run...)
		}
		if t.current != nil && (t.running || t.stopRequested) {
			live = t.current
		}
	}
	threads.Unlock()

	emitted := map[string]bool{}
	for _, e := range prefix {
		if h := head(e); h.MessageID != nil {
			emitted[*h.MessageID] = true
		}
	}
	streamEvents(w, r, prefix, live, func(e json.RawMessage) bool {
		h := head(e)
		return h.MessageID != nil && emitted[*h.MessageID]
	})
}

// stopThread is InMemoryAgentRunner.stop.
func stopThread(threadID string) bool {
	threads.Lock()
	defer threads.Unlock()
	t, ok := threads.m[threadID]
	if !ok || !t.running || t.stopRequested {
		return false
	}
	t.stopRequested, t.running = true, false
	t.cancel()
	return true
}

// suggest is handleSuggestAgent: a run outside the thread store.
func suggest(w http.ResponseWriter, r *http.Request, agent AgentRunner, input RunAgentInput) {
	log := newEventLog()
	go func() {
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		var events []json.RawMessage
		interrupted := pump(ctx, cancel, agent, input, func(e json.RawMessage) {
			events = append(events, e)
			log.push(e)
		})
		if interrupted == nil {
			log.push(finalizeRunEvents(events, false, nil)...)
		}
		log.close()
	}()
	streamEvents(w, r, nil, log, nil)
}

func historicMessageIDs(runs [][]json.RawMessage) map[string]bool {
	ids := map[string]bool{}
	for _, run := range runs {
		for _, e := range run {
			h := head(e)
			if h.MessageID != nil {
				ids[*h.MessageID] = true
			}
			if h.Type == "RUN_STARTED" {
				var in struct {
					Messages []struct {
						ID string `json:"id"`
					} `json:"messages"`
				}
				_ = json.Unmarshal(h.Input, &in)
				for _, m := range in.Messages {
					ids[m.ID] = true
				}
			}
		}
	}
	return ids
}

// withRunInput attaches the request input to a RUN_STARTED that has none,
// minus messages already recorded on the thread.
func withRunInput(e json.RawMessage, input RunAgentInput, historic map[string]bool) json.RawMessage {
	h := head(e)
	if h.Type != "RUN_STARTED" || (len(h.Input) > 0 && string(h.Input) != "null") {
		return e
	}
	messages := make([]Message, 0, len(input.Messages))
	for _, m := range input.Messages {
		if !historic[m.ID] {
			messages = append(messages, m)
		}
	}
	input.Messages = messages
	obj := bytes.TrimSpace(e)
	obj = obj[:len(obj)-1] // drop the closing brace
	sep := ","
	if len(bytes.TrimSpace(obj[1:])) == 0 {
		sep = ""
	}
	out := append(append([]byte{}, bytes.TrimSpace(obj)...), sep+`"input":`...)
	out = append(out, marshal(input)...)
	return append(out, '}')
}

const (
	defaultStopMessage   = "Run stopped by user"
	defaultAbruptMessage = "Run ended without emitting a terminal event"
)

// finalizeRunEvents (@copilotkit/shared) closes a run that ended without
// RUN_FINISHED/RUN_ERROR: open messages and tool calls get their END (and a
// synthetic result), then RUN_FINISHED when stopped or RUN_ERROR otherwise.
func finalizeRunEvents(events []json.RawMessage, stopRequested bool, interruption *string) []json.RawMessage {
	stopMessage, abruptMessage := defaultStopMessage, defaultAbruptMessage
	if interruption != nil {
		stopMessage = *interruption
		if *interruption != "" && *interruption != defaultStopMessage {
			abruptMessage = *interruption
		}
	}

	var openMessages, openTools []string
	toolEnded, toolResult := map[string]bool{}, map[string]bool{}
	for _, e := range events {
		h := head(e)
		switch h.Type {
		case "RUN_FINISHED", "RUN_ERROR":
			return nil
		case "TEXT_MESSAGE_START":
			if h.MessageID != nil && !contains(openMessages, *h.MessageID) {
				openMessages = append(openMessages, *h.MessageID)
			}
		case "TEXT_MESSAGE_END":
			if h.MessageID != nil {
				openMessages = remove(openMessages, *h.MessageID)
			}
		case "TOOL_CALL_START":
			if h.ToolCallID != nil {
				if !contains(openTools, *h.ToolCallID) {
					openTools = append(openTools, *h.ToolCallID)
				}
				toolEnded[*h.ToolCallID], toolResult[*h.ToolCallID] = false, false
			}
		case "TOOL_CALL_END":
			if h.ToolCallID != nil && contains(openTools, *h.ToolCallID) {
				toolEnded[*h.ToolCallID] = true
			}
		case "TOOL_CALL_RESULT":
			if h.ToolCallID != nil && contains(openTools, *h.ToolCallID) {
				toolResult[*h.ToolCallID] = true
			}
		}
	}

	var appended []json.RawMessage
	for _, id := range openMessages {
		appended = append(appended, marshal(synth{Type: "TEXT_MESSAGE_END", MessageID: id}))
	}
	for _, id := range openTools {
		if !toolEnded[id] {
			appended = append(appended, marshal(synth{Type: "TOOL_CALL_END", ToolCallID: id}))
		}
		if !toolResult[id] {
			content := runStatus{"error", "missing_terminal_event", abruptMessage}
			if stopRequested {
				content = runStatus{"stopped", "stop_requested", stopMessage}
			}
			appended = append(appended, marshal(struct {
				Type       string `json:"type"`
				ToolCallID string `json:"toolCallId"`
				MessageID  string `json:"messageId"`
				Role       string `json:"role"`
				Content    string `json:"content"`
			}{"TOOL_CALL_RESULT", id, id + "-result", "tool", string(marshal(content))}))
		}
	}
	if stopRequested {
		return append(appended, json.RawMessage(`{"type":"RUN_FINISHED"}`))
	}
	return append(appended, marshal(struct {
		Type    string `json:"type"`
		Message string `json:"message"`
		Code    string `json:"code"`
	}{"RUN_ERROR", abruptMessage, "INCOMPLETE_STREAM"}))
}

type runStatus struct {
	Status  string `json:"status"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func remove(s []string, v string) []string {
	out := s[:0]
	for _, x := range s {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

// synth is an event transformChunks synthesizes, in its key order.
type synth struct {
	Type            string          `json:"type"`
	MessageID       string          `json:"messageId,omitempty"`
	ToolCallID      string          `json:"toolCallId,omitempty"`
	ToolCallName    string          `json:"toolCallName,omitempty"`
	ParentMessageID *string         `json:"parentMessageId,omitempty"`
	Role            string          `json:"role,omitempty"`
	Name            *string         `json:"name,omitempty"`
	Delta           json.RawMessage `json:"delta,omitempty"`
	SubagentRunID   *string         `json:"subagentRunId,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
}

// chunkTransform is @ag-ui/client transformChunks: *_CHUNK events become
// START/CONTENT(ARGS) events and the stream is closed with END by the next
// explicit event.
// ponytail: one lane for the whole run; per-subagent lanes only matter for agents emitting subagentRunId.
type chunkTransform struct {
	kind, id string // open stream: "text", "tool" or "reasoning"
	subagent *string
}

func (t *chunkTransform) closeLane() []json.RawMessage {
	if t.kind == "" {
		return nil
	}
	e := synth{SubagentRunID: t.subagent}
	switch t.kind {
	case "text":
		e.Type, e.MessageID = "TEXT_MESSAGE_END", t.id
	case "tool":
		e.Type, e.ToolCallID = "TOOL_CALL_END", t.id
	default:
		e.Type, e.MessageID = "REASONING_MESSAGE_END", t.id
	}
	t.kind, t.id, t.subagent = "", "", nil
	return []json.RawMessage{marshal(e)}
}

func (t *chunkTransform) next(raw json.RawMessage) ([]json.RawMessage, error) {
	var h eventHead
	if err := json.Unmarshal(raw, &h); err != nil {
		return nil, err
	}
	switch h.Type {
	case "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
		"TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT",
		"STATE_SNAPSHOT", "STATE_DELTA", "CUSTOM", "STEP_STARTED", "STEP_FINISHED",
		"THINKING_START", "THINKING_END", "THINKING_TEXT_MESSAGE_START", "THINKING_TEXT_MESSAGE_CONTENT", "THINKING_TEXT_MESSAGE_END",
		"REASONING_START", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT", "REASONING_MESSAGE_END", "REASONING_END":
		if h.SubagentRunID != nil {
			return []json.RawMessage{raw}, nil
		}
		return append(t.closeLane(), raw), nil
	case "RUN_STARTED", "RUN_FINISHED", "RUN_ERROR", "MESSAGES_SNAPSHOT":
		return append(t.closeLane(), raw), nil
	case "RAW", "ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA", "REASONING_ENCRYPTED_VALUE",
		"SUBAGENT_STARTED", "SUBAGENT_FINISHED", "SUBAGENT_ERROR":
		return []json.RawMessage{raw}, nil
	case "TEXT_MESSAGE_CHUNK":
		return t.chunk("text", h.MessageID, h)
	case "TOOL_CALL_CHUNK":
		return t.chunk("tool", h.ToolCallID, h)
	case "REASONING_MESSAGE_CHUNK":
		return t.chunk("reasoning", h.MessageID, h)
	}
	return nil, nil
}

var chunkNames = map[string][3]string{
	"text":      {"TEXT_MESSAGE_CHUNK", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"},
	"tool":      {"TOOL_CALL_CHUNK", "TOOL_CALL_START", "TOOL_CALL_ARGS"},
	"reasoning": {"REASONING_MESSAGE_CHUNK", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT"},
}

func (t *chunkTransform) chunk(kind string, id *string, h eventHead) ([]json.RawMessage, error) {
	names := chunkNames[kind]
	var out []json.RawMessage
	if t.kind != kind || (id != nil && *id != t.id) {
		out = t.closeLane()
		idField := "messageId"
		if kind == "tool" {
			idField = "toolCallId"
		}
		if id == nil {
			return nil, fmt.Errorf("First %s must have a %s", names[0], idField)
		}
		if kind == "tool" && h.ToolCallName == nil {
			return nil, errors.New("First TOOL_CALL_CHUNK must have a toolCallName")
		}
		t.kind, t.id, t.subagent = kind, *id, h.SubagentRunID
		start := synth{Type: names[1], SubagentRunID: h.SubagentRunID, Metadata: h.Metadata}
		switch kind {
		case "text":
			start.MessageID, start.Role, start.Name = *id, h.Role, h.Name
			if start.Role == "" {
				start.Role = "assistant"
			}
		case "tool":
			start.ToolCallID, start.ToolCallName, start.ParentMessageID = *id, *h.ToolCallName, h.ParentMessageID
		default:
			start.MessageID, start.Role = *id, "reasoning"
		}
		out = append(out, marshal(start))
	}
	owner := h.SubagentRunID
	if owner == nil {
		owner = t.subagent
	}
	content := synth{Type: names[2], SubagentRunID: owner}
	if kind == "tool" {
		content.ToolCallID = t.id
	} else {
		content.MessageID = t.id
	}
	switch {
	case h.Delta != nil:
		content.Delta, content.Metadata = h.Delta, h.Metadata
		out = append(out, marshal(content))
	case len(out) == 0 && h.Metadata != nil:
		// A metadata-only continuation still reaches the reducer as an empty delta.
		content.Delta, content.Metadata = json.RawMessage(`""`), h.Metadata
		out = append(out, marshal(content))
	}
	return out, nil
}

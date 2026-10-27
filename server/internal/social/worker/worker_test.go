package worker

import (
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

type fakeProvider struct {
	integrations.Provider
	info integrations.Info
}

func (p fakeProvider) Info() integrations.Info { return p.info }

func providers() []integrations.Provider {
	return []integrations.Provider{
		fakeProvider{info: integrations.Info{Identifier: "x", MaxConcurrentJob: 10}},
		fakeProvider{info: integrations.Info{Identifier: "linkedin", MaxConcurrentJob: 8}},
		fakeProvider{info: integrations.Info{Identifier: "linkedin-page", MaxConcurrentJob: 2}},
		fakeProvider{info: integrations.Info{Identifier: "reddit", MaxConcurrentJob: 1}},
		fakeProvider{info: integrations.Info{Identifier: "unset"}},
	}
}

func byQueue(list []queue) map[string]queue {
	out := map[string]queue{}
	for _, q := range list {
		out[q.taskQueue] = q
	}
	return out
}

func TestQueues(t *testing.T) {
	t.Setenv("EXCLUDE_QUEUE", "")
	t.Setenv("WORKER_CONCURRENCY_DIVIDER", "")
	list := queues(providers())

	var names []string
	for _, q := range list {
		names = append(names, q.taskQueue)
	}
	want := []string{"main", "x", "linkedin", "reddit", "unset", "email", "email-bulk"}
	if len(names) != len(want) {
		t.Fatalf("queues = %v", names)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("queues = %v, want %v", names, want)
		}
	}

	q := byQueue(list)
	if !q["main"].workflows || q["main"].options.DisableWorkflowWorker || q["main"].options.MaxConcurrentActivityExecutionSize != 1000000 {
		t.Fatalf("main = %+v", q["main"])
	}
	if q["x"].workflows || !q["x"].options.DisableWorkflowWorker || q["x"].options.MaxConcurrentActivityExecutionSize != 10 ||
		q["x"].options.MaxHeartbeatThrottleInterval.Seconds() != 15 {
		t.Fatalf("x = %+v", q["x"])
	}
	if q["unset"].options.MaxConcurrentActivityExecutionSize != 1 {
		t.Fatalf("unset limit = %d", q["unset"].options.MaxConcurrentActivityExecutionSize)
	}
	if e := q["email"].options; e.MaxConcurrentActivityExecutionSize != 10 || e.TaskQueueActivitiesPerSecond != 3 || !e.DisableWorkflowWorker {
		t.Fatalf("email = %+v", e)
	}
	if e := q["email-bulk"].options; e.MaxConcurrentActivityExecutionSize != 10 || e.TaskQueueActivitiesPerSecond != 2 {
		t.Fatalf("email-bulk = %+v", e)
	}
}

func TestQueuesDividerAndExclusions(t *testing.T) {
	t.Setenv("EXCLUDE_QUEUE", " reddit , email-bulk,")
	t.Setenv("WORKER_CONCURRENCY_DIVIDER", "3")
	q := byQueue(queues(providers()))

	if _, ok := q["reddit"]; ok {
		t.Fatal("reddit not excluded")
	}
	if _, ok := q["email-bulk"]; ok {
		t.Fatal("email-bulk not excluded")
	}
	if _, ok := q["email"]; !ok {
		t.Fatal("email missing")
	}
	// floor(10/3) = 3, floor(8/3) = 2, main stays unlimited
	if got := q["x"].options.MaxConcurrentActivityExecutionSize; got != 3 {
		t.Fatalf("x = %d", got)
	}
	if got := q["linkedin"].options.MaxConcurrentActivityExecutionSize; got != 2 {
		t.Fatalf("linkedin = %d", got)
	}
	if got := q["main"].options.MaxConcurrentActivityExecutionSize; got != 1000000 {
		t.Fatalf("main = %d", got)
	}

	// never below 1
	t.Setenv("WORKER_CONCURRENCY_DIVIDER", "50")
	if got := byQueue(queues(providers()))["x"].options.MaxConcurrentActivityExecutionSize; got != 1 {
		t.Fatalf("x = %d", got)
	}
	// invalid or below 1 means 1
	for _, v := range []string{"abc", "0", "-4", "0.5"} {
		t.Setenv("WORKER_CONCURRENCY_DIVIDER", v)
		if got := byQueue(queues(providers()))["x"].options.MaxConcurrentActivityExecutionSize; got != 10 {
			t.Fatalf("divider %q: x = %d", v, got)
		}
	}
}

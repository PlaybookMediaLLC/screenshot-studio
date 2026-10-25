package temporalmaintenance

import (
	"context"
	"fmt"
	"testing"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestWorkflowRetriesAndPropagatesExhaustedFailures(t *testing.T) {
	for _, failures := range []int{1, 4} {
		t.Run(fmt.Sprint(failures), func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			calls := 0
			env.RegisterActivityWithOptions(func(_ context.Context, job string) (int, error) {
				calls++
				if job != "tenant-outbox" {
					t.Fatal(job)
				}
				if calls <= failures {
					return 0, fmt.Errorf("temporary")
				}
				return 3, nil
			}, activity.RegisterOptions{Name: ActivityName})
			env.ExecuteWorkflow(Workflow, "tenant-outbox")
			if failures == 1 {
				if env.GetWorkflowError() != nil {
					t.Fatal(env.GetWorkflowError())
				}
				var count int
				if err := env.GetWorkflowResult(&count); err != nil || count != 3 {
					t.Fatalf("count %d error %v", count, err)
				}
				if calls != 2 {
					t.Fatal(calls)
				}
			} else {
				if env.GetWorkflowError() == nil || calls != 3 {
					t.Fatalf("error %v calls %d", env.GetWorkflowError(), calls)
				}
			}
		})
	}
}
func TestUnknownJobIsRejected(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.ExecuteWorkflow(Workflow, "invalid-job")
	if env.GetWorkflowError() == nil {
		t.Fatal("unknown jobs must not execute")
	}
}

type fakeSchedules struct {
	client.ScheduleClient
	created map[string]client.ScheduleOptions
	handles map[string]*fakeHandle
}
type fakeHandle struct {
	client.ScheduleHandle
	schedule client.Schedule
}

func (f *fakeSchedules) Create(_ context.Context, o client.ScheduleOptions) (client.ScheduleHandle, error) {
	if _, ok := f.created[o.ID]; ok {
		return nil, temporal.ErrScheduleAlreadyRunning
	}
	f.created[o.ID] = o
	f.handles[o.ID] = &fakeHandle{schedule: client.Schedule{Spec: &o.Spec, Action: o.Action, State: &client.ScheduleState{Paused: true}}}
	return f.handles[o.ID], nil
}
func (f *fakeSchedules) GetHandle(_ context.Context, id string) client.ScheduleHandle {
	return f.handles[id]
}
func (f *fakeHandle) Update(_ context.Context, o client.ScheduleUpdateOptions) error {
	u, e := o.DoUpdate(client.ScheduleUpdateInput{Description: client.ScheduleDescription{Schedule: f.schedule}})
	if e == nil {
		f.schedule = *u.Schedule
	}
	return e
}
func TestScheduleReconciliationPreservesPauseAndCadence(t *testing.T) {
	f := &fakeSchedules{created: map[string]client.ScheduleOptions{}, handles: map[string]*fakeHandle{}}
	for range 2 {
		if err := Reconcile(context.Background(), f); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.created) != len(Jobs) {
		t.Fatalf("created %d schedules", len(f.created))
	}
	for id, o := range f.created {
		if o.Overlap != enumspb.SCHEDULE_OVERLAP_POLICY_SKIP {
			t.Fatal("overlap enabled")
		}
		if !f.handles[id].schedule.State.Paused {
			t.Fatal("operator pause cleared")
		}
		if id == "platform-maintenance-audit-retention" {
			if o.Spec.TimeZoneName != "UTC" || o.Spec.CronExpressions[0] != "5 3 * * *" {
				t.Fatal(o.Spec)
			}
		} else if id == "platform-maintenance-account-deletions" || id == "platform-maintenance-social-analytics" {
			// Deletions wait out a 14-day grace period; hourly is prompt enough.
			if len(o.Spec.Intervals) != 1 || o.Spec.Intervals[0].Every != time.Hour {
				t.Fatal(o.Spec)
			}
		} else if len(o.Spec.Intervals) != 1 || o.Spec.Intervals[0].Every != time.Minute {
			t.Fatal(o.Spec)
		}
		if o.Action.(*client.ScheduleWorkflowAction).TaskQueue != TaskQueue {
			t.Fatal("maintenance must have a separate queue")
		}
	}
}

package activities

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/lucsky/cuid"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/proto"
)

func credentialProbeWorkflow(ctx workflow.Context, org, id, post string) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second, RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	var account *Integration
	if err := workflow.ExecuteActivity(ctx, GetIntegrationByID, org, id).Get(ctx, &account); err != nil {
		return err
	}
	var posts []Post
	if err := workflow.ExecuteActivity(ctx, GetPostsList, org, post).Get(ctx, &posts); err != nil {
		return err
	}
	var refreshed OrFalse[integrations.AuthTokenDetails]
	if err := workflow.ExecuteActivity(ctx, RefreshToken, account).Get(ctx, &refreshed); err != nil {
		return err
	}
	return workflow.ExecuteActivity(ctx, PostSocial, account, posts[:1]).Get(ctx, nil)
}

func TestCredentialPayloadsInRealTemporalHistory(t *testing.T) {
	address := os.Getenv("SOCIAL_TEST_TEMPORAL_ADDRESS")
	if address == "" {
		t.Skip("SOCIAL_TEST_TEMPORAL_ADDRESS is not set")
	}
	if !strings.HasPrefix(address, "127.0.0.1:") && !strings.HasPrefix(address, "localhost:") {
		t.Fatal("requires a disposable local Temporal server")
	}
	namespace := os.Getenv("SOCIAL_TEST_TEMPORAL_NAMESPACE")
	if !strings.Contains(namespace, "test") {
		t.Fatal("requires a disposable test namespace")
	}
	f := setup(t)
	refresh, custom := "original-private-refresh", "encrypted-private-custom"
	f.client.Integration.UpdateOneID(f.in.ID).SetRefreshToken(&refresh).SetCustomInstanceDetails(custom).ExecX(f.ctx)
	ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
	defer cancel()
	c, err := client.DialContext(ctx, client.Options{HostPort: address, Namespace: namespace})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	queue := "credential-probe-" + cuid.New()
	w := worker.New(c, queue, worker.Options{})
	w.RegisterWorkflow(credentialProbeWorkflow)
	w.RegisterActivityWithOptions(f.a.GetIntegrationByID, activity.RegisterOptions{Name: GetIntegrationByID})
	w.RegisterActivityWithOptions(f.a.GetPostsList, activity.RegisterOptions{Name: GetPostsList})
	w.RegisterActivityWithOptions(f.a.RefreshToken, activity.RegisterOptions{Name: RefreshToken})
	w.RegisterActivityWithOptions(f.a.PostSocial, activity.RegisterOptions{Name: PostSocial})
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	run, err := c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: queue, TaskQueue: queue, WorkflowExecutionTimeout: 25 * time.Second}, credentialProbeWorkflow, f.in.OrganizationID, f.in.ID, f.root.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer c.TerminateWorkflow(ctx, run.GetID(), run.GetRunID(), "fixture cleanup")
	if err := run.Get(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if f.provider.token != "rotated-access" {
		t.Fatal("provider did not use the credential stored by refresh")
	}
	history := &historypb.History{}
	it := c.GetWorkflowHistory(ctx, run.GetID(), run.GetRunID(), false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for it.HasNext() {
		event, err := it.Next()
		if err != nil {
			t.Fatal(err)
		}
		history.Events = append(history.Events, event)
	}
	data, err := proto.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"secret-token", refresh, custom, "rotated-access", "rotated-refresh"} {
		if bytes.Contains(data, []byte(forbidden)) {
			t.Fatal("provider credentials appeared in durable workflow history")
		}
	}
	if !bytes.Contains(data, []byte("backend-owned")) {
		t.Fatal("history did not contain the refresh success marker")
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflow(credentialProbeWorkflow)
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatal(err)
	}
}

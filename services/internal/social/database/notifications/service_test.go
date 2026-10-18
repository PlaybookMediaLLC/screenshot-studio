package notifications

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

// fakeTemporal records SignalWithStartWorkflow calls.
type fakeTemporal struct {
	client.Client
	calls []string
	opts  client.StartWorkflowOptions
	arg   any
	input any
}

func (f *fakeTemporal) SignalWithStartWorkflow(_ context.Context, workflowID, signalName string, signalArg any,
	options client.StartWorkflowOptions, workflow any, args ...any) (client.WorkflowRun, error) {
	f.calls = append(f.calls, workflowID+"|"+signalName+"|"+workflow.(string))
	f.opts, f.arg, f.input = options, signalArg, args[0]
	return nil, nil
}

type fakeEmail struct{ sent []string }

func (f *fakeEmail) HasProvider() bool { return true }

func (f *fakeEmail) SendEmail(_ context.Context, to, subject, html, addTo, _ string) error {
	f.sent = append(f.sent, to+"|"+subject+"|"+html+"|"+addTo)
	return nil
}

func TestNotifications(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	email := &fakeEmail{}
	service := NewService(NewRepository(client), email, organizations.NewRepository(client), nil)

	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	other := client.Organization.Create().SetName("Other").SaveX(ctx)
	quiet := client.User.Create().SetEmail("quiet@x.io").SetProviderName(user.ProviderNameLOCAL).SetTimezone(0).
		SetSendSuccessEmails(false).SetSendFailureEmails(false).
		SetLastReadNotifications(time.Now().Add(-time.Hour)).SaveX(ctx)
	loud := client.User.Create().SetEmail("loud@x.io").SetProviderName(user.ProviderNameLOCAL).SetTimezone(0).SaveX(ctx)
	client.UserOrganization.Create().SetOrganization(org).SetUser(quiet).SetRole(userorganization.RoleSUPERADMIN).ExecX(ctx)
	client.UserOrganization.Create().SetOrganization(org).SetUser(loud).SetRole(userorganization.RoleUSER).ExecX(ctx)

	for i := 0; i < 12; i++ {
		if err := service.InAppNotification(ctx, org.ID, "s", "message "+string(rune('a'+i)), false, false, TypeSuccess); err != nil {
			t.Fatal(err)
		}
	}
	client.Notifications.Create().SetOrganizationID(other.ID).SetContent("not mine").ExecX(ctx)
	deleted := client.Notifications.Create().SetOrganizationID(org.ID).SetContent("deleted").SetDeletedAt(time.Now()).SaveX(ctx)

	if d := time.Since(deleted.CreatedAt); d < -time.Minute || d > time.Minute {
		t.Fatalf("createdAt round trip is off by %v", d)
	}

	count, err := service.GetMainPageCount(ctx, org.ID, quiet.ID)
	if err != nil || count.Total != 13 {
		t.Fatalf("count %+v %v", count, err)
	}

	page, err := service.GetNotificationsPaginated(ctx, org.ID, 0)
	if err != nil || page.Total != 12 || len(page.Notifications) != 12 || page.HasMore || page.Limit != 100 {
		t.Fatalf("page %+v %v", page, err)
	}
	for i := 1; i < len(page.Notifications); i++ {
		if page.Notifications[i-1].CreatedAt.Time.Before(page.Notifications[i].CreatedAt.Time) {
			t.Errorf("notifications out of descending timestamp order at %d", i)
			break
		}
	}
	data, _ := json.Marshal(page.Notifications[0])
	if !strings.Contains(string(data), `"link":null`) || !strings.Contains(string(data), `.`) || !strings.HasSuffix(string(data), `Z"}`) {
		t.Errorf("json %s", data)
	}

	before := client.User.GetX(ctx, quiet.ID).LastReadNotifications
	recent, err := service.GetNotifications(ctx, org.ID, quiet.ID)
	if err != nil || len(recent.Notifications) != 10 || !recent.LastReadNotifications.Equal(before) {
		t.Fatalf("recent %+v %v", recent, err)
	}
	if count, _ := service.GetMainPageCount(ctx, org.ID, quiet.ID); count.Total != 0 {
		t.Errorf("all read, got %d", count.Total)
	}
	if _, err := service.GetMainPageCount(ctx, org.ID, "missing"); err == nil {
		t.Error("unknown user must fail")
	}

	// Email preferences: success/fail honor them, info always goes out.
	if err := service.InAppNotification(ctx, org.ID, "Done", "ok", true, false, TypeSuccess); err != nil {
		t.Fatal(err)
	}
	if err := service.SendEmailsToOrg(ctx, org.ID, "Info", "fyi", TypeInfo); err != nil {
		t.Fatal(err)
	}
	want := []string{"loud@x.io|Done|ok|top"}
	if len(email.sent) != 3 || email.sent[0] != want[0] {
		t.Errorf("sent %v", email.sent)
	}

	// Digest without a Temporal client only stores the notification.
	if err := service.InAppNotification(ctx, org.ID, "Digest", "later", true, true, TypeFail); err != nil {
		t.Fatal(err)
	}
	if len(email.sent) != 3 {
		t.Errorf("digest must not email directly: %v", email.sent)
	}
}

func TestDigestSignal(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	temporal := &fakeTemporal{}
	service := NewService(NewRepository(client), &fakeEmail{}, organizations.NewRepository(client), temporal)
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)

	if err := service.InAppNotification(ctx, org.ID, "Title", "Body", true, true, TypeFail); err != nil {
		t.Fatal(err)
	}
	if len(temporal.calls) != 1 || temporal.calls[0] != "digest_email_workflow_"+org.ID+"|email|digestEmailWorkflow" {
		t.Fatalf("calls %v", temporal.calls)
	}
	if temporal.opts.TaskQueue != "main" || temporal.opts.ID != "digest_email_workflow_"+org.ID ||
		temporal.opts.WorkflowIDConflictPolicy != enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING ||
		temporal.opts.TypedSearchAttributes.Size() != 1 {
		t.Errorf("options %+v", temporal.opts)
	}
	signal, _ := json.Marshal(temporal.arg)
	input, _ := json.Marshal(temporal.input)
	if string(signal) != `[{"title":"Title","message":"Body","type":"fail"}]` || string(input) != `{"organizationId":"`+org.ID+`"}` {
		t.Errorf("signal %s input %s", signal, input)
	}
}

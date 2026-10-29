package product

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/lucsky/cuid"
)

// The Pro plan's seat and social channel limits in workspaceplan/capacity.go.
const proSeats, proChannels = 10, 15

func TestPlanLimitsCapSeatsAndChannels(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	id := cuid.New()
	userID, orgID := "user_"+id, "org_"+id
	for _, fixture := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, []any{userID, id + "@example.test"}},
		{`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,'Limits',$2,now())`, []any{orgID, id}},
		{`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$2,now(),now(),$3,$4)`, []any{"session_" + id, "token_" + id, userID, orgID}},
		{`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, []any{"member_" + id, orgID, userID}},
	} {
		if _, err := db.SQL.ExecContext(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, orgID)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, userID)
	})
	repo := NewConfiguration(db.Client).WithInvitationMailer(&recordingInvitationMailer{})
	actor := Actor{OrganizationID: orgID, UserID: userID, SessionID: "session_" + id, RequestID: "request_" + id}
	var atLimit *PlanLimitError

	// Without a subscription the owner holds the only seat.
	if _, err := repo.InviteMember(ctx, actor, "first-"+id+"@example.test", "viewer"); !errors.As(err, &atLimit) ||
		atLimit.Name != LimitSeats || err.Error() != "Choose a plan to add seats." {
		t.Fatalf("unsubscribed invite err=%v", err)
	}
	if err := repo.RequireChannel(ctx, orgID, "integration-0"); err != nil {
		t.Fatalf("unsubscribed channel err=%v", err)
	}

	// The owner and pending invitations fill Pro's seats.
	subscribe(t, ctx, repo, orgID, "pro")
	for i := range proSeats - 1 {
		if _, err := repo.InviteMember(ctx, actor, fmt.Sprintf("invite-%d-%s@example.test", i, id), "viewer"); err != nil {
			t.Fatalf("invite %d: %v", i, err)
		}
	}
	if _, err := repo.InviteMember(ctx, actor, "over-"+id+"@example.test", "viewer"); !errors.As(err, &atLimit) || atLimit.Limit != proSeats ||
		err.Error() != fmt.Sprintf("The Pro plan includes %d seats. Upgrade the plan to add more.", proSeats) {
		t.Fatalf("invite past the seats err=%v", err)
	}
	// Accepting a pending invitation uses the seat it already holds.
	if err := repo.RequireSeat(ctx, orgID, false); err != nil {
		t.Fatalf("accepting an invitation err=%v", err)
	}

	// Pro's social channels fill up; reconnecting one it holds still works.
	for i := range proChannels {
		if err := repo.RequireChannel(ctx, orgID, fmt.Sprintf("integration-%d", i)); err != nil {
			t.Fatalf("channel %d: %v", i, err)
		}
		if err := db.Client.ChannelConnection.Create().SetID(cuid.New()).SetOrganizationID(orgID).
			SetExternalAccountID(fmt.Sprintf("integration-%d", i)).SetSecretReference("SOCIAL_API_KEY").
			SetCreatedByUserID(userID).Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	over := fmt.Sprintf("integration-%d", proChannels)
	if err := repo.RequireChannel(ctx, orgID, over); !errors.As(err, &atLimit) || atLimit.Limit != proChannels ||
		err.Error() != fmt.Sprintf("The Pro plan includes %d social channels. Upgrade the plan to add more.", proChannels) {
		t.Fatalf("channel past the limit err=%v", err)
	}
	if err := repo.RequireChannel(ctx, orgID, "integration-0"); err != nil {
		t.Fatalf("reconnecting a held channel err=%v", err)
	}
	// A disconnected channel frees its slot.
	if err := db.Client.ChannelConnection.Update().Where(channelconnection.OrganizationID(orgID),
		channelconnection.ExternalAccountID("integration-2")).SetStatus(channelconnection.StatusREVOKED).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if err := repo.RequireChannel(ctx, orgID, over); err != nil {
		t.Fatalf("channel after a disconnect err=%v", err)
	}
	if err := db.Client.ChannelConnection.Update().Where(channelconnection.OrganizationID(orgID),
		channelconnection.ExternalAccountID("integration-2")).SetStatus(channelconnection.StatusACTIVE).Exec(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.SyncWorkspaceEntitlement(ctx, EntitlementSyncInput{EventID: "upgrade-" + orgID, EventType: "test.upgraded",
		ExpectedVersion: 1, OrganizationID: orgID, Plan: "enterprise", Provider: "test", Status: "active"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.RequireChannel(ctx, orgID, over); err != nil {
		t.Fatalf("enterprise channel err=%v", err)
	}
	if _, err := repo.InviteMember(ctx, actor, "over-"+id+"@example.test", "viewer"); err != nil {
		t.Fatalf("enterprise invite err=%v", err)
	}
}

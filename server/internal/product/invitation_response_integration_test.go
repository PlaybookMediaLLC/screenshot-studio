package product

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	entgo "entgo.io/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func invitationRecipient(t *testing.T, w *testWorkspace, name string) (Actor, string) {
	t.Helper()
	id, email := "user_"+name+"_"+w.id, name+"-"+w.id+"@example.test"
	w.exec(t, `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())`, id, name, email)
	w.exec(t, `INSERT INTO session (id,token,"expiresAt","createdAt","updatedAt","userId") VALUES($1,$1,now()+interval '1 hour',now(),now(),$2)`, "session_"+name+"_"+w.id, id)
	return w.actor(name), email
}

func inviteRecipient(t *testing.T, w *testWorkspace, name string) (Actor, *InvitationDetail) {
	t.Helper()
	actor, email := invitationRecipient(t, w, name)
	item, err := w.repo.InviteMember(w.ctx, w.owner, email, "viewer")
	if err != nil {
		t.Fatal(err)
	}
	return actor, item
}

func invitationMembershipCount(t *testing.T, w *testWorkspace, actor Actor) int {
	t.Helper()
	n, err := w.db.Client.Member.Query().Where(member.OrganizationID(w.org), member.UserID(actor.UserID)).Count(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestInvitationResponsesAreAtomicAndRecipientBound(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithInvitationMailer(&recordingInvitationMailer{})
	subscribe(t, w.ctx, w.repo, w.org, "business")
	recipient, item := inviteRecipient(t, w, "accepted")
	wrong, _ := invitationRecipient(t, w, "wrong")
	for _, action := range []string{"accept", "reject"} {
		if _, err := w.repo.RespondInvitation(w.ctx, wrong, item.ID, action); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("wrong recipient %s: %v", action, err)
		}
	}
	if _, err := w.repo.GetRecipientInvitation(w.ctx, wrong, item.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign metadata: %v", err)
	}
	result, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept")
	if err != nil {
		t.Fatal(err)
	}
	if result.Invitation.Status != "accepted" || result.Member == nil || result.Member.Role != "viewer" || result.Member.OrganizationID != w.org {
		t.Fatalf("result=%+v", result)
	}
	active, err := w.db.Client.Session.Get(w.ctx, recipient.SessionID)
	if err != nil || active.ActiveOrganizationID == nil || *active.ActiveOrganizationID != w.org {
		t.Fatalf("active destination: %+v %v", active, err)
	}
	for _, action := range []string{"accept", "reject"} {
		if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, action); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("reused link %s: %v", action, err)
		}
	}
	if invitationMembershipCount(t, w, recipient) != 1 {
		t.Fatal("duplicate membership")
	}
	n, err := w.db.Client.AuditLog.Query().Where(auditlog.OrganizationID(w.org), auditlog.Action("product.member_invitation_accepted")).Count(w.ctx)
	if err != nil || n != 1 {
		t.Fatalf("accept audits=%d %v", n, err)
	}
	n, err = w.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(w.org), outboxevent.Type("activity.member.joined")).Count(w.ctx)
	// The workspace owner is created by the fixture before this acceptance.
	if err != nil || n != 2 {
		t.Fatalf("membership events=%d %v", n, err)
	}
	declined, decline := inviteRecipient(t, w, "declined")
	if _, err := w.repo.RespondInvitation(w.ctx, declined, decline.ID, "reject"); err != nil {
		t.Fatal(err)
	}
	if invitationMembershipCount(t, w, declined) != 0 {
		t.Fatal("decline granted access")
	}
	state, err := w.repo.GetRecipientInvitation(w.ctx, declined, decline.ID)
	if err != nil || state.Status != "rejected" {
		t.Fatalf("decline status %+v %v", state, err)
	}
	if _, err := w.repo.RespondInvitation(w.ctx, declined, decline.ID, "accept"); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("decline reused: %v", err)
	}
	for _, kind := range []string{"api_key", "support", "service", "webhook"} {
		actor := declined
		actor.Kind = kind
		if _, err := w.repo.RespondInvitation(w.ctx, actor, decline.ID, "accept"); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("machine %s: %v", kind, err)
		}
	}
	expired, expiry := inviteRecipient(t, w, "expired")
	w.exec(t, `UPDATE invitation SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`, expiry.ID)
	for _, action := range []string{"accept", "reject"} {
		if _, err := w.repo.RespondInvitation(w.ctx, expired, expiry.ID, action); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("expired %s: %v", action, err)
		}
	}
	state, err = w.repo.GetRecipientInvitation(w.ctx, expired, expiry.ID)
	if err != nil || state.Status != "expired" {
		t.Fatalf("expiry state %+v %v", state, err)
	}
	revoked, revoke := inviteRecipient(t, w, "revoked")
	if err := w.repo.RevokeInvitation(w.ctx, w.owner, revoke.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.RespondInvitation(w.ctx, revoked, revoke.ID, "accept"); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("revoked: %v", err)
	}
	if invitationMembershipCount(t, w, expired)+invitationMembershipCount(t, w, revoked) != 0 {
		t.Fatal("inactive link granted access")
	}
}

func TestInvitationFinalWriteFailureRollsBackMembershipSessionAndAudit(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithInvitationMailer(&recordingInvitationMailer{})
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	recipient, item := inviteRecipient(t, w, "rollback")
	injected := errors.New("injected final invitation write failure")
	w.db.Client.Invitation.Use(func(next entgo.Mutator) entgo.Mutator {
		return entgo.MutateFunc(func(ctx context.Context, m entgo.Mutation) (entgo.Value, error) {
			if mutation, ok := m.(*ent.InvitationMutation); ok {
				if status, _ := mutation.Status(); status == "accepted" {
					return nil, injected
				}
			}
			return next.Mutate(ctx, m)
		})
	})
	if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept"); !errors.Is(err, injected) {
		t.Fatalf("expected injected failure: %v", err)
	}
	if invitationMembershipCount(t, w, recipient) != 0 {
		t.Fatal("partial membership survived rollback")
	}
	saved, err := w.db.Client.Invitation.Get(w.ctx, item.ID)
	if err != nil || saved.Status != "pending" {
		t.Fatalf("invitation consumed %+v %v", saved, err)
	}
	active, err := w.db.Client.Session.Get(w.ctx, recipient.SessionID)
	if err != nil || active.ActiveOrganizationID != nil {
		t.Fatalf("partial active workspace %+v %v", active, err)
	}
	count, err := w.db.Client.AuditLog.Query().Where(auditlog.OrganizationID(w.org), auditlog.Action("product.member_invitation_accepted")).Count(w.ctx)
	if err != nil || count != 0 {
		t.Fatalf("partial audit %d %v", count, err)
	}
}

func TestInvitationConcurrentLastSeatAndTerminalStates(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithInvitationMailer(&recordingInvitationMailer{})
	subscribe(t, w.ctx, w.repo, w.org, "business")
	for i := 0; i < proSeats-2; i++ {
		w.addMember(t, fmt.Sprintf("existing%d", i), "viewer")
	}
	a, ia := inviteRecipient(t, w, "seat_a")
	b, ib := inviteRecipient(t, w, "seat_b")
	// A plan downgrade makes two previously held invitations compete for one seat.
	if _, err := w.repo.SyncWorkspaceEntitlement(w.ctx, EntitlementSyncInput{ExpectedVersion: 1, EventID: "invite-downgrade-" + w.id, EventType: "test.downgraded", OrganizationID: w.org, Plan: "pro", Provider: "test", Status: "active"}); err != nil {
		t.Fatal(err)
	}
	inputs := []struct {
		actor Actor
		id    string
	}{{a, ia.ID}, {b, ib.ID}}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, input := range inputs {
		wg.Add(1)
		go func(i int, actor Actor, id string) {
			defer wg.Done()
			_, errs[i] = w.repo.RespondInvitation(w.ctx, actor, id, "accept")
		}(i, input.actor, input.id)
	}
	wg.Wait()
	accepted, denied := 0, 0
	for _, err := range errs {
		var limit *PlanLimitError
		if err == nil {
			accepted++
		} else if errors.As(err, &limit) {
			denied++
		} else {
			t.Fatal(err)
		}
	}
	if accepted != 1 || denied != 1 {
		t.Fatalf("seat outcomes %v", errs)
	}
	count, err := w.db.Client.Member.Query().Where(member.OrganizationID(w.org)).Count(w.ctx)
	if err != nil || count != proSeats {
		t.Fatalf("seats=%d %v", count, err)
	}
	for i, input := range inputs {
		saved, err := w.db.Client.Invitation.Get(w.ctx, input.id)
		if err != nil {
			t.Fatal(err)
		}
		if errs[i] != nil && saved.Status != "pending" {
			t.Fatal("denied acceptance consumed invitation")
		}
	}
	if _, err := w.repo.SyncWorkspaceEntitlement(w.ctx, EntitlementSyncInput{ExpectedVersion: 2, EventID: "invite-upgrade-" + w.id, EventType: "test.upgraded", OrganizationID: w.org, Plan: "business", Provider: "test", Status: "active"}); err != nil {
		t.Fatal(err)
	}
	recipient, item := inviteRecipient(t, w, "terminal")
	actions := []string{"accept", "reject"}
	for i, action := range actions {
		wg.Add(1)
		go func(i int, action string) {
			defer wg.Done()
			_, errs[i] = w.repo.RespondInvitation(w.ctx, recipient, item.ID, action)
		}(i, action)
	}
	wg.Wait()
	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, publishing.ErrConflict) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("terminal outcomes %v", errs)
	}
	saved, err := w.db.Client.Invitation.Get(w.ctx, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := 0
	if saved.Status == "accepted" {
		want = 1
	}
	if invitationMembershipCount(t, w, recipient) != want {
		t.Fatal("terminal state does not match membership")
	}
}

func TestInvitationConcurrentCreationReservesLastSeat(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithInvitationMailer(&recordingInvitationMailer{})
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	for i := 0; i < proSeats-2; i++ {
		w.addMember(t, fmt.Sprintf("member%d", i), "viewer")
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = w.repo.InviteMember(w.ctx, w.owner, fmt.Sprintf("reserve%d-%s@example.test", i, w.id), "viewer")
		}(i)
	}
	wg.Wait()
	success, denied := 0, 0
	for _, err := range errs {
		var limit *PlanLimitError
		if err == nil {
			success++
		} else if errors.As(err, &limit) {
			denied++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || denied != 1 {
		t.Fatalf("reservation outcomes %v", errs)
	}
}

func TestInvitationRechecksIdentityAndInviterAuthority(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithInvitationMailer(&recordingInvitationMailer{})
	subscribe(t, w.ctx, w.repo, w.org, "business")
	recipient, item := inviteRecipient(t, w, "identity")
	w.exec(t, `UPDATE "user" SET "emailVerified"=false WHERE id=$1`, recipient.UserID)
	if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("unverified email: %v", err)
	}
	w.exec(t, `UPDATE "user" SET "emailVerified"=true,banned=true WHERE id=$1`, recipient.UserID)
	if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("banned: %v", err)
	}
	w.exec(t, `UPDATE "user" SET banned=false WHERE id=$1`, recipient.UserID)
	w.exec(t, `UPDATE session SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`, recipient.SessionID)
	if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept"); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatalf("expired session: %v", err)
	}
	w.exec(t, `UPDATE session SET "expiresAt"=now()+interval '1 hour' WHERE id=$1`, recipient.SessionID)
	w.addMember(t, "inviter", "admin")
	w.exec(t, `UPDATE invitation SET "inviterId"=$1 WHERE id=$2`, w.actor("inviter").UserID, item.ID)
	w.exec(t, `UPDATE member SET role='viewer' WHERE "organizationId"=$1 AND "userId"=$2`, w.org, w.actor("inviter").UserID)
	if _, err := w.repo.RespondInvitation(w.ctx, recipient, item.ID, "accept"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("demoted inviter: %v", err)
	}
	if _, err := w.repo.InviteMember(w.ctx, w.actor("inviter"), "denied-"+w.id+"@example.test", "admin"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer invitation: %v", err)
	}
	// Recipient reads and decline need only one pooled connection too.
	w.db.SQL.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(w.ctx, 5*time.Second)
	defer cancel()
	if _, err := w.repo.RespondInvitation(ctx, recipient, item.ID, "reject"); err != nil {
		t.Fatal(err)
	}
}

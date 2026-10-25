package tenantpublishing

import (
	"context"
	"testing"

	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

type dmPoster struct {
	fakePoster
	sent int
}

func (p *dmPoster) SendDirectMessage(_ context.Context, in *socialent.Integration, recipient, text string) (string, error) {
	p.sent++
	return "dm-receipt", nil
}
func TestDirectMessagesBindNativeIdentityAndTenantConnection(t *testing.T) {
	p, _, _, _ := directFixture()
	account := p.integrations.(fakeIntegrations).item
	verifiedDirectAccount(t, account, "x")
	provider := &dmPoster{}
	p.resolve = func(string) poster { return provider }
	sender := DirectMessageSender{Publisher: p, OrganizationID: "product-org", DestinationID: "destination", SecretReference: "SOCIAL_API_KEY", AccountID: account.InternalID}
	id, err := sender.Send(context.Background(), account.InternalID, "2", "Requested guide")
	if err != nil || id != "dm-receipt" || provider.sent != 1 {
		t.Fatalf("receipt=%s err=%v", id, err)
	}
	wrong := sender
	wrong.SecretReference = "other-binding"
	if _, err = wrong.Send(context.Background(), account.InternalID, "2", "No"); err == nil || provider.sent != 1 {
		t.Fatal("foreign tenant secret reached DM transport")
	}
	if _, err = sender.Send(context.Background(), "other-account", "2", "No"); err == nil || provider.sent != 1 {
		t.Fatal("native identity mismatch reached DM transport")
	}
	account.Disabled = true
	if _, err = sender.Send(context.Background(), account.InternalID, "2", "No"); err == nil || provider.sent != 1 {
		t.Fatal("disabled connection reached DM transport")
	}
}

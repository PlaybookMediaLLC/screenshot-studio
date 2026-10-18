package tenantpublishing

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	productent "github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

type fakeBindings struct {
	item *productent.PostizTenantBinding
}

func (f fakeBindings) Binding(context.Context, string) (*productent.PostizTenantBinding, error) {
	return f.item, nil
}

type fakeIntegrations struct{ item *socialent.Integration }

func (f fakeIntegrations) FindIntegration(context.Context, string, string, string) (*socialent.Integration, error) {
	return f.item, nil
}

type fakeSigner struct{ calls int }

func (f *fakeSigner) SignDelivery(_ context.Context, organizationID, key string) (string, error) {
	f.calls++
	if !strings.HasPrefix(key, "org/"+organizationID+"/") {
		return "", errors.New("wrong tenant media")
	}
	return "https://r2.example/private/image.png?fresh-signature", nil
}

type fakePoster struct {
	calls  int
	media  int
	path   string
	err    error
	status string
}

func (f *fakePoster) Post(_ context.Context, id, token string, posts []integrations.PostDetails, _ *socialent.Integration) ([]integrations.PostResponse, error) {
	f.calls++
	if id != "remote-user" || token != "private-token" || len(posts) != 1 || posts[0].ID != "canonical-post-1" {
		return nil, errors.New("incorrect provider input")
	}
	f.path, f.media = posts[0].Media[0].Path, len(posts[0].Media)
	if f.err != nil {
		return nil, f.err
	}
	status := f.status
	if status == "" {
		status = "posted"
	}
	return []integrations.PostResponse{{PostID: "remote-post-1", Status: status}}, nil
}

func directFixture() (*Publisher, *fakeSigner, *fakePoster, postiz.PublishInput) {
	signer, fakeProvider := &fakeSigner{}, &fakePoster{}
	p := &Publisher{
		bindings:     fakeBindings{&productent.PostizTenantBinding{GoOrganizationID: "social-org", SecretReference: "POSTIZ_API_KEY"}},
		integrations: fakeIntegrations{&socialent.Integration{ID: "destination", OrganizationID: "social-org", ProviderIdentifier: "linkedin", InternalID: "remote-user", Token: "private-token"}},
		signer:       signer, resolve: func(string) poster { return fakeProvider },
		now: func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) },
	}
	return p, signer, fakeProvider, postiz.PublishInput{
		OrganizationID: "product-org", DestinationID: "destination", Platform: "linkedin",
		PostID:          "canonical-post-1",
		SecretReference: "POSTIZ_API_KEY", AssetObjectKey: "org/product-org/image.png", AssetMediaType: "image/png", Caption: "Canary",
	}
}

func TestDirectPublisherUsesFreshSignedMediaAndRemoteReceipt(t *testing.T) {
	p, signer, poster, input := directFixture()
	id, err := p.Publish(context.Background(), input)
	if err != nil || id != "remote-post-1" || signer.calls != 1 || poster.calls != 1 || poster.path != "https://r2.example/private/image.png?fresh-signature" {
		t.Fatalf("id=%q err=%v signer=%d provider=%d path=%q", id, err, signer.calls, poster.calls, poster.path)
	}
}

func TestDirectPublisherSendsEveryAssetInOnePost(t *testing.T) {
	p, signer, poster, input := directFixture()
	input.Assets = []publishing.MediaAsset{{MediaType: "image/png", ObjectKey: "org/product-org/1.png"},
		{MediaType: "image/png", ObjectKey: "org/product-org/2.png"}}
	if _, err := p.Publish(context.Background(), input); err != nil || signer.calls != 2 || poster.media != 2 {
		t.Fatalf("err=%v signer=%d media=%d", err, signer.calls, poster.media)
	}
}

func TestDirectPublisherAcceptsConfirmedInstagramReceipt(t *testing.T) {
	p, _, poster, input := directFixture()
	input.Platform = "instagram-standalone"
	p.integrations = fakeIntegrations{&socialent.Integration{ID: "destination", OrganizationID: "social-org", ProviderIdentifier: input.Platform, InternalID: "remote-user", Token: "private-token"}}
	poster.status = "success"
	id, err := p.Publish(context.Background(), input)
	if err != nil || id != "remote-post-1" || poster.calls != 1 {
		t.Fatalf("id=%q err=%v providerCalls=%d", id, err, poster.calls)
	}
}

func TestDirectPublisherRejectsExpiredCredentialsBeforeMediaOrProviderCall(t *testing.T) {
	p, signer, poster, input := directFixture()
	expired := p.integrations.(fakeIntegrations)
	date := time.Date(2026, 10, 14, 11, 0, 0, 0, time.UTC)
	expired.item.TokenExpiration = &date
	p.integrations = expired
	_, err := p.Publish(context.Background(), input)
	if err == nil || signer.calls != 0 || poster.calls != 0 {
		t.Fatalf("err=%v signer=%d provider=%d", err, signer.calls, poster.calls)
	}
}

func TestDirectPublisherMarksAmbiguousProviderFailureUnknown(t *testing.T) {
	p, _, poster, input := directFixture()
	poster.err = context.DeadlineExceeded
	_, err := p.Publish(context.Background(), input)
	var providerErr *postiz.Error
	if !errors.As(err, &providerErr) || !providerErr.UnknownDelivery || poster.calls != 1 {
		t.Fatalf("err=%v providerCalls=%d", err, poster.calls)
	}
}

func TestDirectPublisherFailsExpiredCredentialWithoutUnknownDelivery(t *testing.T) {
	p, _, poster, input := directFixture()
	poster.err = temporalx.RefreshToken("linkedin", "{}", "{}", "expired")
	_, err := p.Publish(context.Background(), input)
	var providerErr *postiz.Error
	if !errors.As(err, &providerErr) || providerErr.UnknownDelivery || providerErr.Status != 409 || poster.calls != 1 {
		t.Fatalf("err=%v providerCalls=%d", err, poster.calls)
	}
}

func TestDirectPublisherRejectsWrongWorkspaceBinding(t *testing.T) {
	p, signer, poster, input := directFixture()
	input.SecretReference = "OTHER_WORKSPACE_KEY"
	_, err := p.Publish(context.Background(), input)
	if err == nil || signer.calls != 0 || poster.calls != 0 {
		t.Fatalf("err=%v signer=%d provider=%d", err, signer.calls, poster.calls)
	}
}

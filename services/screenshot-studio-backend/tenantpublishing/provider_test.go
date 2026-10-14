package tenantpublishing

import (
	"context"
	"errors"
	"testing"
	"time"

	productent "github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
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

type fakeMedia struct{ calls int }

func (f *fakeMedia) UploadAsset(context.Context, postiz.PublishInput) (string, error) {
	f.calls++
	return "https://r2.example/private/image.png", nil
}

type fakeSigner struct{ calls int }

func (f *fakeSigner) SignManagedURL(_ context.Context, path string) (string, error) {
	f.calls++
	return path + "?fresh-signature", nil
}

type fakePoster struct {
	calls int
	path  string
	err   error
}

func (f *fakePoster) Post(_ context.Context, id, token string, posts []integrations.PostDetails, _ *socialent.Integration) ([]integrations.PostResponse, error) {
	f.calls++
	if id != "remote-user" || token != "private-token" || len(posts) != 1 || posts[0].ID != "canonical-post-1" {
		return nil, errors.New("incorrect provider input")
	}
	f.path = posts[0].Media[0].Path
	if f.err != nil {
		return nil, f.err
	}
	return []integrations.PostResponse{{PostID: "remote-post-1", Status: "posted"}}, nil
}

func directFixture() (*Publisher, *fakeMedia, *fakeSigner, *fakePoster, postiz.PublishInput) {
	media, signer, fakeProvider := &fakeMedia{}, &fakeSigner{}, &fakePoster{}
	p := &Publisher{
		bindings:     fakeBindings{&productent.PostizTenantBinding{GoOrganizationID: "social-org", SecretReference: "POSTIZ_API_KEY"}},
		integrations: fakeIntegrations{&socialent.Integration{ID: "destination", OrganizationID: "social-org", ProviderIdentifier: "linkedin", InternalID: "remote-user", Token: "private-token"}},
		media:        media, signer: signer, resolve: func(string) poster { return fakeProvider },
		now: func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) },
	}
	return p, media, signer, fakeProvider, postiz.PublishInput{
		OrganizationID: "product-org", DestinationID: "destination", Platform: "linkedin",
		PostID:          "canonical-post-1",
		SecretReference: "POSTIZ_API_KEY", AssetObjectKey: "org/product-org/image.png", AssetMediaType: "image/png", Caption: "Canary",
	}
}

func TestDirectPublisherUsesFreshSignedMediaAndRemoteReceipt(t *testing.T) {
	p, media, signer, poster, input := directFixture()
	id, err := p.Publish(context.Background(), input)
	if err != nil || id != "remote-post-1" || media.calls != 1 || signer.calls != 1 || poster.calls != 1 || poster.path != "https://r2.example/private/image.png?fresh-signature" {
		t.Fatalf("id=%q err=%v media=%d signer=%d provider=%d path=%q", id, err, media.calls, signer.calls, poster.calls, poster.path)
	}
}

func TestDirectPublisherRejectsExpiredCredentialsBeforeMediaOrProviderCall(t *testing.T) {
	p, media, _, poster, input := directFixture()
	expired := p.integrations.(fakeIntegrations)
	date := time.Date(2026, 10, 14, 11, 0, 0, 0, time.UTC)
	expired.item.TokenExpiration = &date
	p.integrations = expired
	_, err := p.Publish(context.Background(), input)
	if err == nil || media.calls != 0 || poster.calls != 0 {
		t.Fatalf("err=%v media=%d provider=%d", err, media.calls, poster.calls)
	}
}

func TestDirectPublisherMarksAmbiguousProviderFailureUnknown(t *testing.T) {
	p, _, _, poster, input := directFixture()
	poster.err = context.DeadlineExceeded
	_, err := p.Publish(context.Background(), input)
	var providerErr *postiz.Error
	if !errors.As(err, &providerErr) || !providerErr.UnknownDelivery || poster.calls != 1 {
		t.Fatalf("err=%v providerCalls=%d", err, poster.calls)
	}
}

func TestDirectPublisherRejectsWrongWorkspaceBinding(t *testing.T) {
	p, media, _, poster, input := directFixture()
	input.SecretReference = "OTHER_WORKSPACE_KEY"
	_, err := p.Publish(context.Background(), input)
	if err == nil || media.calls != 0 || poster.calls != 0 {
		t.Fatalf("err=%v media=%d provider=%d", err, media.calls, poster.calls)
	}
}

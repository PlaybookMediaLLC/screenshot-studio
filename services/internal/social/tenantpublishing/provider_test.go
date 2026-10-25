package tenantpublishing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	productent "github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
)

type fakeBindings struct {
	item *productent.SocialTenantBinding
}

func (f fakeBindings) Binding(context.Context, string) (*productent.SocialTenantBinding, error) {
	return f.item, nil
}

type fakeIntegrations struct{ item *socialent.Integration }

func (f fakeIntegrations) FindIntegration(context.Context, string, string, string) (*socialent.Integration, error) {
	if f.item == nil {
		return nil, nil
	}
	row := *f.item
	return &row, nil
}

type fakeSigner struct {
	calls     int
	afterSign func()
	err       error
}

func (f *fakeSigner) SignDelivery(_ context.Context, organizationID, key string) (string, error) {
	f.calls++
	if f.afterSign != nil {
		f.afterSign()
	}
	if f.err != nil {
		return "", f.err
	}
	if !strings.HasPrefix(key, "org/"+organizationID+"/") {
		return "", errors.New("wrong tenant media")
	}
	return "https://r2.example/private/image.png?fresh-signature", nil
}

type fakePoster struct {
	quoteState string
	calls      int
	media      int
	// replies records each reply as "message>answers", in order.
	replies          []string
	poll             *integrations.PollDetails
	path             string
	err              error
	status           string
	expectedNativeID string
	afterPost        func()
	afterReply       func()
}

func (f *fakePoster) Post(_ context.Context, id, token string, posts []integrations.PostDetails, _ *socialent.Integration) ([]integrations.PostResponse, error) {
	f.calls++
	wantID := f.expectedNativeID
	if wantID == "" {
		wantID = "remote-user"
	}
	if id != wantID || token != "private-token" || len(posts) != 1 || posts[0].ID != "canonical-post-1" {
		return nil, errors.New("incorrect provider input")
	}
	f.path, f.media, f.poll = posts[0].Media[0].Path, len(posts[0].Media), posts[0].Poll
	if f.err != nil {
		return nil, f.err
	}
	status := f.status
	if status == "" {
		status = "posted"
	}
	if f.afterPost != nil {
		f.afterPost()
	}
	return []integrations.PostResponse{{PostID: "remote-post-1", Status: status, QuoteState: f.quoteState}}, nil
}

func (f *fakePoster) Comment(_ context.Context, _, postID, lastCommentID, _ string, posts []integrations.PostDetails, _ *socialent.Integration) ([]integrations.PostResponse, error) {
	answers := lastCommentID
	if answers == "" {
		answers = postID
	}
	f.replies = append(f.replies, posts[0].Message+">"+answers)
	if f.afterReply != nil {
		f.afterReply()
	}
	return []integrations.PostResponse{{PostID: fmt.Sprintf("reply-%d", len(f.replies)), QuoteState: f.quoteState}}, nil
}

func TestNativeQuoteReceiptsPreservePublishedRootAndReplies(t *testing.T) {
	for _, replies := range []int{0, 1} {
		p, _, poster, input := directFixture()
		poster.quoteState = "pending"
		if replies > 0 {
			input.Replies = []publishing.PublishReply{{Caption: "Finisher"}}
		}
		result, err := p.PublishThread(context.Background(), input)
		if err != nil || result.PostID != "remote-post-1" || result.Thread.Posted != replies || len(result.Thread.Quotes) != replies+1 || poster.calls != 1 {
			t.Fatalf("published outcome lost: %#v %v", result, err)
		}
		for _, quote := range result.Thread.Quotes {
			if quote.PostID == "" || quote.State != "pending" {
				t.Fatal(quote)
			}
		}
	}
}

func directFixture() (*Publisher, *fakeSigner, *fakePoster, socialapi.PublishInput) {
	signer, fakeProvider := &fakeSigner{}, &fakePoster{}
	p := &Publisher{
		bindings:     fakeBindings{&productent.SocialTenantBinding{GoOrganizationID: "social-org", SecretReference: "SOCIAL_API_KEY"}},
		integrations: fakeIntegrations{&socialent.Integration{ID: "destination", OrganizationID: "social-org", ProviderIdentifier: "linkedin", InternalID: "remote-user", Token: "private-token"}},
		signer:       signer, resolve: func(string) poster { return fakeProvider },
		now: func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) },
	}
	return p, signer, fakeProvider, socialapi.PublishInput{
		OrganizationID: "product-org", DestinationID: "destination", Platform: "linkedin",
		PostID:          "canonical-post-1",
		SecretReference: "SOCIAL_API_KEY", AssetObjectKey: "org/product-org/image.png", AssetMediaType: "image/png", Caption: "Canary",
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

func TestDirectPublisherPostsAThreadAsChainedReplies(t *testing.T) {
	p, _, poster, input := directFixture()
	input.Replies = []publishing.PublishReply{{Caption: "two"}, {Caption: "three"}}
	id, err := p.Publish(context.Background(), input)
	if err != nil || id != "remote-post-1" || strings.Join(poster.replies, ",") != "two>remote-post-1,three>reply-1" {
		t.Fatalf("id=%q err=%v replies=%v", id, err, poster.replies)
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

func TestDirectPublisherAcceptsCompletedBlueskyReceipt(t *testing.T) {
	p, _, poster, input := directFixture()
	input.Platform = "bluesky"
	account := p.integrations.(fakeIntegrations).item
	verifiedDirectAccount(t, account, input.Platform)
	poster.expectedNativeID = account.InternalID
	poster.status = "completed"
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
	var providerErr *socialapi.Error
	if !errors.As(err, &providerErr) || !providerErr.UnknownDelivery || poster.calls != 1 {
		t.Fatalf("err=%v providerCalls=%d", err, poster.calls)
	}
}

func TestDirectPublisherFailsExpiredCredentialWithoutUnknownDelivery(t *testing.T) {
	p, _, poster, input := directFixture()
	poster.err = temporalx.RefreshToken("linkedin", "{}", "{}", "expired")
	_, err := p.Publish(context.Background(), input)
	var providerErr *socialapi.Error
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

func TestDirectPublisherResumesAThreadAndReportsProgress(t *testing.T) {
	p, _, poster, input := directFixture()
	input.ReplyTo = "live-reply-2"
	input.Replies = []publishing.PublishReply{{Caption: "four"}}
	receipt, err := p.PublishThread(context.Background(), input)
	// The resumed first part answers the live post; the rest answer it.
	if err != nil || poster.calls != 0 || strings.Join(poster.replies, ",") != "Canary>live-reply-2,four>reply-1" ||
		receipt.Thread.Posted != 1 || receipt.Thread.Total != 1 || receipt.Thread.LastReplyID != "reply-2" {
		t.Fatalf("receipt=%+v err=%v replies=%v", receipt, err, poster.replies)
	}
}

func TestDirectPublisherSendsAPoll(t *testing.T) {
	p, _, poster, input := directFixture()
	input.Poll = &postoptions.Poll{DurationMinutes: 90, Options: []string{"Yes", "No"}}
	if _, err := p.Publish(context.Background(), input); err != nil || poster.poll == nil || poster.poll.Duration != 2 || poster.poll.DurationMinutes != 90 {
		t.Fatalf("err=%v poll=%+v", err, poster.poll)
	}
}

func TestDirectPublisherKeepsInvalidPollsForProviderValidation(t *testing.T) {
	for _, poll := range []*postoptions.Poll{
		{DurationMinutes: 60},
		{Options: []string{"Only one"}, DurationMinutes: 60},
		{Options: []string{"A", "B"}, DurationMinutes: 0},
	} {
		p, _, provider, input := directFixture()
		input.Poll = poll
		if _, err := p.Publish(context.Background(), input); err != nil {
			t.Fatal(err)
		}
		if provider.poll == nil || len(provider.poll.Options) != len(poll.Options) || provider.poll.DurationMinutes != poll.DurationMinutes {
			t.Fatalf("invalid poll dropped or changed before validation: %+v", provider.poll)
		}
		if poll.DurationMinutes == 0 && provider.poll.Duration != 0 {
			t.Fatalf("zero minutes became a valid legacy duration: %+v", provider.poll)
		}
	}
}

type uncertainAutoPoster struct {
	fakePoster
	repostErr error
	plugCalls int
}

func (p *uncertainAutoPoster) AutoRepostPost(context.Context, *socialent.Integration, string, map[string]string) (bool, error) {
	return false, p.repostErr
}
func (p *uncertainAutoPoster) AutoPlugPost(context.Context, *socialent.Integration, string, map[string]string) (bool, error) {
	p.plugCalls++
	return false, temporalx.UnknownDelivery("x", "Uncertain reply")
}

func TestLegacyAutoActStopsAfterUncertainRepost(t *testing.T) {
	p, _, _, input := directFixture()
	provider := &uncertainAutoPoster{repostErr: temporalx.UnknownDelivery("x", "Uncertain repost")}
	p.resolve = func(string) poster { return provider }
	result, err := p.AutoAct(context.Background(), socialapi.AutoActionInput{OrganizationID: input.OrganizationID, DestinationID: input.DestinationID, Platform: input.Platform, SecretReference: input.SecretReference, RemotePostID: "42", Repost: true, RepostAtLikes: 1, Plug: true, PlugAtLikes: 1, PlugText: "reply", Quote: true, QuoteText: "later"})
	if temporalx.FailureType(err) != temporalx.TypeUnknownDelivery || result.Reposted || provider.plugCalls != 0 || provider.calls != 0 {
		t.Fatalf("uncertainty swallowed or later mutation sent: %+v %v plugs=%d calls=%d", result, err, provider.plugCalls, provider.calls)
	}
}
func TestLegacyAutoActPreservesUnknownDelivery(t *testing.T) {
	p, _, _, input := directFixture()
	provider := &uncertainAutoPoster{}
	p.resolve = func(string) poster { return provider }
	result, err := p.AutoAct(context.Background(), socialapi.AutoActionInput{OrganizationID: input.OrganizationID, DestinationID: input.DestinationID, Platform: input.Platform, SecretReference: input.SecretReference, RemotePostID: "42", Plug: true, PlugAtLikes: 1, PlugText: "reply", Quote: true, QuoteText: "later"})
	if temporalx.FailureType(err) != temporalx.TypeUnknownDelivery || result.Plugged || provider.calls != 0 {
		t.Fatalf("uncertainty swallowed or later mutation sent: %+v %v calls=%d", result, err, provider.calls)
	}
}

func TestDirectPublisherPreservesDefiniteRejection(t *testing.T) {
	p, _, poster, input := directFixture()
	poster.err = temporalx.PublicationRejected("x", "invalid poll")
	_, err := p.Publish(context.Background(), input)
	var providerErr *socialapi.Error
	if !errors.As(err, &providerErr) || providerErr.UnknownDelivery || providerErr.Status != 400 || poster.calls != 1 {
		t.Fatalf("known rejection became unknown: %v", err)
	}
}

func TestLegacyBadBodyCannotProveRejectedDelivery(t *testing.T) {
	err := publicationOutcome(temporalx.BadBody("linkedin", "{}", "{}", "may already be published"))
	var providerErr *socialapi.Error
	if !errors.As(err, &providerErr) || !providerErr.UnknownDelivery {
		t.Fatalf("unsafe retry enabled: %v", err)
	}
}

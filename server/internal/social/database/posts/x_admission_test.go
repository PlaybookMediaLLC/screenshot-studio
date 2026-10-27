package posts

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	xprovider "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/x"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func TestXAdmissionUsesScopedVerifiedAccountLimits(t *testing.T) {
	f := setup(t)
	f.svc.integrationManager = integrations.NewManager([]integrations.Provider{xprovider.New()})
	subscription := "Basic"
	caps := socialidentity.Capabilities{Version: 1, X: func() *socialidentity.XCapabilities {
		c := socialidentity.XVerifiedAccountLimits("read-write", &subscription)
		return &c
	}()}
	f.integration = f.client.Integration.UpdateOne(f.integration).SetProviderIdentifier("x").SetInternalID("1").SetVerifiedAccountKey("x:1").SetVerifiedAccountKind("profile").SetVerifiedScopes([]string{"read-write"}).SetVerifiedCapabilities(&caps).SetIdentityVerifiedAt(time.Now()).SetAdditionalSettings(`[{"title":"Verified","value":false}]`).SaveX(f.ctx)
	validate := func(settings string, texts ...string) PostValidation {
		values := make([]dtos.PostContent, len(texts))
		for i, text := range texts {
			values[i] = dtos.PostContent{Content: text}
		}
		result, err := f.svc.ValidatePosts(f.ctx, f.org.ID, []dtos.Post{{Integration: dtos.Integration{ID: f.integration.ID}, Settings: json.RawMessage(settings), Value: values}})
		if err != nil || len(result) != 1 {
			t.Fatalf("validation: %+v %v", result, err)
		}
		return result[0]
	}
	regular := `{"who_can_reply_post":"everyone"}`
	got := validate(regular, strings.Repeat("a", 25000))
	if !got.Valid || got.TooLong || got.MaximumCharacters != 25000 {
		t.Fatalf("Basic allowance ignored: %+v", got)
	}
	if !validate(regular, strings.Repeat("a", 25001)).TooLong {
		t.Fatal("over-limit post accepted")
	}
	article := `{"post_type":"article","article_title":"Title","article_status":"published"}`
	if validate(article, "Article text").Valid {
		t.Fatal("Basic incorrectly grants Articles")
	}
	subscription = "Premium"
	c := socialidentity.XVerifiedAccountLimits("read-write", &subscription)
	caps.X = &c
	f.client.Integration.UpdateOneID(f.integration.ID).SetVerifiedCapabilities(&caps).ExecX(f.ctx)
	got = validate(article, strings.Repeat("a", 50000), strings.Repeat("a", 25001))
	if !got.Valid || !got.TooLong || got.MaximumCharacters != 100000 {
		t.Fatalf("Article reply inherited body limit: %+v", got)
	}
	subscription = "None"
	c = socialidentity.XVerifiedAccountLimits("read-write", &subscription)
	caps.X = &c
	f.client.Integration.UpdateOneID(f.integration.ID).SetVerifiedCapabilities(&caps).SetAdditionalSettings(`[{"title":"Verified","value":true}]`).ExecX(f.ctx)
	got = validate(regular, strings.Repeat("a", 281))
	if !got.TooLong || got.MaximumCharacters != 280 {
		t.Fatalf("editable flag granted access: %+v", got)
	}
	f.client.Integration.UpdateOneID(f.integration.ID).ClearVerifiedAccountKey().ClearVerifiedAccountKind().ClearVerifiedScopes().ClearVerifiedCapabilities().ClearIdentityVerifiedAt().ExecX(f.ctx)
	if validate(regular, "hello").Valid {
		t.Fatal("missing proof accepted")
	}
	if _, err := f.svc.ValidatePosts(f.ctx, "other-organization", []dtos.Post{{Integration: dtos.Integration{ID: f.integration.ID}, Settings: json.RawMessage(regular), Value: []dtos.PostContent{{Content: "hello"}}}}); err == nil {
		t.Fatal("foreign account admitted")
	}
}

func TestUnknownDeliveryMessageRemainsVisible(t *testing.T) {
	raw := `{"cause":{"type":"unknown_delivery","failure":{"message":"Check X before trying again to avoid duplicates."}}}`
	message := curatedError(&raw)
	if message == nil || *message != "Check X before trying again to avoid duplicates." {
		t.Fatalf("unknown delivery warning hidden: %v", message)
	}
}

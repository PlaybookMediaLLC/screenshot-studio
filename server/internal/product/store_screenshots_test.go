package product

import (
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

func validInput() CreateStoreReviewInput {
	return CreateStoreReviewInput{
		ProjectID: "4f8a2c1e-0000-4000-8000-000000000001", Name: " Launch set ", VersionLabel: "v3", ProjectRevision: 12,
		Slides: []StoreReviewSlide{{SlideID: "slide-1", Name: "Prepare", AssetID: "8d1f0000-0000-4000-8000-000000000001", Width: 660, Height: 1434}},
	}
}

func TestValidReviewInputAcceptsAndTrims(t *testing.T) {
	input := validInput()
	if !validReviewInput(&input) || input.Name != "Launch set" {
		t.Fatalf("expected valid trimmed input, got %+v", input)
	}
}

func TestValidReviewInputRejectsBadSlides(t *testing.T) {
	cases := map[string]func(*CreateStoreReviewInput){
		"bad asset id":     func(input *CreateStoreReviewInput) { input.Slides[0].AssetID = "not-a-uuid" },
		"duplicate slides": func(input *CreateStoreReviewInput) { input.Slides = append(input.Slides, input.Slides[0]) },
		"huge image":       func(input *CreateStoreReviewInput) { input.Slides[0].Width = 9000 },
		"bad project":      func(input *CreateStoreReviewInput) { input.ProjectID = "../../etc" },
		"no slides":        func(input *CreateStoreReviewInput) { input.Slides = nil },
		"long name":        func(input *CreateStoreReviewInput) { input.Name = strings.Repeat("x", 121) },
	}
	for name, mutate := range cases {
		input := validInput()
		mutate(&input)
		if validReviewInput(&input) {
			t.Errorf("%s: expected invalid", name)
		}
	}
}

func TestLinkAccessNeedsCurrentTokenAndNoRevocation(t *testing.T) {
	row := &ent.StoreReview{ShareTokenID: "token-123"}
	if !linkAllowed(row, "token-123") {
		t.Fatal("current token should open the review")
	}
	if linkAllowed(row, "token-124") || linkAllowed(row, "") {
		t.Fatal("other or empty tokens must not open the review")
	}
	now := row.CreatedAt
	row.RevokedAt = &now
	if linkAllowed(row, "token-123") {
		t.Fatal("a revoked review must not open")
	}
}

func TestSlidesRoundTripFromJSON(t *testing.T) {
	slides := slidesFromJSON([]map[string]any{{"slideId": "a", "name": "A", "assetId": "id", "width": float64(10), "height": float64(20)}})
	if len(slides) != 1 || slides[0].Width != 10 || slides[0].Height != 20 || slides[0].SlideID != "a" {
		t.Fatalf("unexpected slides %+v", slides)
	}
}

// A freshly saved row still holds the ints it was built with; reads from the
// database hold float64. Both must decode, or the create response reports
// zero-sized slides.
func TestSlidesDecodeFromFreshlySavedRow(t *testing.T) {
	slides := slidesFromJSON([]map[string]any{{"slideId": "a", "name": "A", "assetId": "id", "width": 900, "height": 1955}})
	if len(slides) != 1 || slides[0].Width != 900 || slides[0].Height != 1955 {
		t.Fatalf("unexpected slides %+v", slides)
	}
}

func TestEncryptedSecretFormatOnlyAcceptsCiphertext(t *testing.T) {
	if !encryptedSecretFormat.MatchString("aXY.dGFn.Y2lwaGVy") {
		t.Fatal("iv.tag.ciphertext should be accepted")
	}
	if encryptedSecretFormat.MatchString("-----BEGIN PRIVATE KEY-----") {
		t.Fatal("a plaintext key must be refused")
	}
}

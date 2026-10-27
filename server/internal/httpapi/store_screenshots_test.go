package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type fakeStoreReviews struct {
	fakeConfiguration
	sharedToken  string
	commentToken string
	comment      product.AddStoreReviewCommentInput
	resolved     *bool
	reviewInput  product.CreateStoreReviewInput
	credential   product.CreateStorePublishingCredentialInput
}

func (f *fakeStoreReviews) CreateStoreReview(_ context.Context, actor product.Actor, input product.CreateStoreReviewInput) (*product.StoreReviewRecord, error) {
	f.actor, f.reviewInput = actor, input
	return &product.StoreReviewRecord{ID: "review-1", ProjectID: input.ProjectID, ShareTokenID: "token-1"}, nil
}

func (f *fakeStoreReviews) GetSharedStoreReview(_ context.Context, _ product.Actor, id, token string) (*product.StoreReviewRecord, error) {
	f.sharedToken = token
	if token != "token-1" {
		return nil, publishing.ErrNotFound
	}
	return &product.StoreReviewRecord{ID: id}, nil
}

func (f *fakeStoreReviews) AddStoreReviewComment(_ context.Context, _ product.Actor, _ string, input product.AddStoreReviewCommentInput) (*product.StoreReviewComment, error) {
	f.comment, f.commentToken = input, input.ShareTokenID
	return &product.StoreReviewComment{ID: "comment-1", SlideID: input.SlideID, Body: input.Body}, nil
}

func (f *fakeStoreReviews) ResolveStoreReviewComment(_ context.Context, _ product.Actor, _, _ string, resolved bool) error {
	f.resolved = &resolved
	return nil
}

func (f *fakeStoreReviews) CreateStorePublishingCredential(_ context.Context, _ product.Actor, input product.CreateStorePublishingCredentialInput) (*product.StorePublishingCredential, error) {
	f.credential = input
	return &product.StorePublishingCredential{ID: "cred-1", Provider: input.Provider, Label: input.Label}, nil
}

func storeRequest(handler http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	request.Header.Set("X-Session-ID", "session-1")
	request.Header.Set("X-Request-ID", "request-1")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestStoreReviewRoutes(t *testing.T) {
	store := &fakeStoreReviews{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", store)

	created := storeRequest(handler, http.MethodPost, "/v1/store-reviews",
		`{"projectId":"4f8a2c1e-0000-4000-8000-000000000001","name":"Set","slides":[{"slideId":"s1","assetId":"a","width":10,"height":20}]}`, nil)
	if created.Code != http.StatusCreated || store.reviewInput.Slides[0].SlideID != "s1" || store.actor.OrganizationID != "org-1" {
		t.Fatalf("create status=%d input=%+v", created.Code, store.reviewInput)
	}

	missing := storeRequest(handler, http.MethodGet, "/v1/store-reviews/ckreview0000000000000001/shared", "", map[string]string{"X-Share-Token-Id": "wrong"})
	if missing.Code != http.StatusNotFound || store.sharedToken != "wrong" {
		t.Fatalf("wrong token status=%d token=%q", missing.Code, store.sharedToken)
	}
	shared := storeRequest(handler, http.MethodGet, "/v1/store-reviews/ckreview0000000000000001/shared", "", map[string]string{"X-Share-Token-Id": "token-1"})
	if shared.Code != http.StatusOK {
		t.Fatalf("shared status=%d", shared.Code)
	}

	comment := storeRequest(handler, http.MethodPost, "/v1/store-reviews/ckreview0000000000000001/comments",
		`{"slideId":"s1","body":"Bigger headline","authorName":"Ana","shareTokenId":"spoofed"}`, map[string]string{"X-Share-Token-Id": "token-1"})
	if comment.Code != http.StatusCreated || store.commentToken != "token-1" || store.comment.Body != "Bigger headline" {
		t.Fatalf("comment status=%d token=%q", comment.Code, store.commentToken)
	}

	resolved := storeRequest(handler, http.MethodPut, "/v1/store-reviews/ckreview0000000000000001/comments/ckcomment000000000000001/resolution", `{"resolved":true}`, nil)
	if resolved.Code != http.StatusOK || store.resolved == nil || !*store.resolved {
		t.Fatalf("resolve status=%d", resolved.Code)
	}

	invalid := storeRequest(handler, http.MethodGet, "/v1/store-reviews/..%2F/shared", "", nil)
	if invalid.Code != http.StatusBadRequest && invalid.Code != http.StatusNotFound {
		t.Fatalf("invalid id status=%d", invalid.Code)
	}
}

func TestStoreCredentialRouteNeverEchoesSecret(t *testing.T) {
	store := &fakeStoreReviews{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", store)
	response := storeRequest(handler, http.MethodPost, "/v1/store-publishing/credentials",
		`{"provider":"APP_STORE_CONNECT","label":"Main","metadata":{"issuerId":"i","keyId":"k"},"encryptedSecret":"aXY.dGFn.Y2lwaGVy"}`, nil)
	if response.Code != http.StatusCreated || store.credential.EncryptedSecret != "aXY.dGFn.Y2lwaGVy" {
		t.Fatalf("status=%d input=%+v", response.Code, store.credential)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, leaked := body["encryptedSecret"]; leaked {
		t.Fatal("create must not echo the secret")
	}
}

package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

// A review link opens one snapshot, accepts comments only with its current
// token, keeps comments on their slide ids, and stops working when revoked.
// Credentials keep only ciphertext and stay inside their workspace.
func TestStoreReviewLifecycleAndCredentials(t *testing.T) {
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
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	org, other, owner, viewer := "org_"+id, "other_"+id, "owner_"+id, "viewer_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	for _, organization := range []string{org, other} {
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
	}
	for role, user := range map[string]string{"owner": owner, "viewer": viewer} {
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,now(),now())`, user, user+"@example.test")
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, "session_"+user, user, org)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, "member_"+user, org, user, role)
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1 OR id=$2`, owner, viewer)
	})
	assetA, assetB, foreignAsset := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for asset, organization := range map[string]string{assetA: org, assetB: org, foreignAsset: other} {
		exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/jpeg',1,'UPLOADED',now(),now())`, asset, organization, "key/"+asset)
	}
	repo := NewConfiguration(db.Client)
	subscribe(t, ctx, repo, org, "pro")
	subscribe(t, ctx, repo, other, "pro")
	session := Actor{OrganizationID: org, UserID: owner, SessionID: "session_" + owner, RequestID: "req_" + id}
	viewerSession := Actor{OrganizationID: org, UserID: viewer, SessionID: "session_" + viewer}
	link := Actor{OrganizationID: org, Kind: "service", Display: "review-link"}
	foreignLink := Actor{OrganizationID: other, Kind: "service", Display: "review-link"}
	project := uuid.NewString()
	input := CreateStoreReviewInput{ProjectID: project, Name: "Launch", VersionLabel: "v1", ProjectRevision: 4, Slides: []StoreReviewSlide{
		{SlideID: "slide-a", Name: "A", AssetID: assetA, Width: 660, Height: 1434},
		{SlideID: "slide-b", Name: "B", AssetID: assetB, Width: 660, Height: 1434},
	}}

	if _, err := repo.CreateStoreReview(ctx, viewerSession, input); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer created a review: %v", err)
	}
	foreignInput := input
	foreignInput.Slides = []StoreReviewSlide{{SlideID: "slide-a", AssetID: foreignAsset, Width: 1, Height: 1}}
	if _, err := repo.CreateStoreReview(ctx, session, foreignInput); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("review used another workspace's image: %v", err)
	}
	review, err := repo.CreateStoreReview(ctx, session, input)
	if err != nil || review.ShareTokenID == "" {
		t.Fatalf("create: %+v %v", review, err)
	}
	if _, err := repo.GetSharedStoreReview(ctx, link, review.ID, "wrong"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("wrong token opened the review: %v", err)
	}
	if _, err := repo.GetSharedStoreReview(ctx, foreignLink, review.ID, review.ShareTokenID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("another workspace opened the review: %v", err)
	}
	if _, err := repo.GetSharedStoreReview(ctx, session, review.ID, review.ShareTokenID); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("shared read is service-only: %v", err)
	}
	x, y := 40.0, 12.5
	comment, err := repo.AddStoreReviewComment(ctx, link, review.ID, AddStoreReviewCommentInput{SlideID: "slide-b", X: &x, Y: &y, AuthorName: "Ana", Body: "Make the headline bigger", ShareTokenID: review.ShareTokenID})
	if err != nil || !comment.FromLink {
		t.Fatalf("link comment: %+v %v", comment, err)
	}
	if _, err := repo.AddStoreReviewComment(ctx, link, review.ID, AddStoreReviewCommentInput{SlideID: "slide-z", AuthorName: "Ana", Body: "x", ShareTokenID: review.ShareTokenID}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("comment on unknown slide: %v", err)
	}
	if _, err := repo.AddStoreReviewComment(ctx, viewerSession, review.ID, AddStoreReviewCommentInput{SlideID: "slide-a", AuthorName: "Viewer", Body: "Looks good"}); err != nil {
		t.Fatalf("member comment: %v", err)
	}
	if err := repo.ResolveStoreReviewComment(ctx, viewerSession, review.ID, comment.ID, true); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer resolved a comment: %v", err)
	}
	if err := repo.ResolveStoreReviewComment(ctx, session, review.ID, comment.ID, true); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	shared, err := repo.GetSharedStoreReview(ctx, link, review.ID, review.ShareTokenID)
	if err != nil || len(shared.Comments) != 2 || shared.Comments[0].SlideID != "slide-b" || shared.Comments[0].ResolvedAt == nil {
		t.Fatalf("shared review: %+v %v", shared, err)
	}
	listed, err := repo.ListStoreReviews(ctx, session, project)
	if err != nil || len(listed) != 1 || len(listed[0].Comments) != 2 {
		t.Fatalf("list: %+v %v", listed, err)
	}
	if err := repo.RevokeStoreReview(ctx, session, review.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := repo.RevokeStoreReview(ctx, session, review.ID); err != nil {
		t.Fatalf("second revoke should be a no-op: %v", err)
	}
	if _, err := repo.GetSharedStoreReview(ctx, link, review.ID, review.ShareTokenID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("revoked link still opens: %v", err)
	}
	if _, err := repo.AddStoreReviewComment(ctx, link, review.ID, AddStoreReviewCommentInput{SlideID: "slide-a", AuthorName: "Ana", Body: "late", ShareTokenID: review.ShareTokenID}); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("revoked link accepted a comment: %v", err)
	}

	credentialInput := CreateStorePublishingCredentialInput{Provider: "APP_STORE_CONNECT", Label: "Main", Metadata: map[string]string{"issuerId": "i", "keyId": "k"}, EncryptedSecret: "aXY.dGFn.Y2lwaGVy"}
	if _, err := repo.CreateStorePublishingCredential(ctx, viewerSession, credentialInput); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer stored a credential: %v", err)
	}
	if _, err := repo.CreateStorePublishingCredential(ctx, link, credentialInput); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("service stored a credential: %v", err)
	}
	plaintext := credentialInput
	plaintext.EncryptedSecret = "-----BEGIN PRIVATE KEY-----"
	if _, err := repo.CreateStorePublishingCredential(ctx, session, plaintext); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("plaintext secret accepted: %v", err)
	}
	credential, err := repo.CreateStorePublishingCredential(ctx, session, credentialInput)
	if err != nil {
		t.Fatalf("credential: %v", err)
	}
	secret, err := repo.GetStorePublishingCredentialSecret(ctx, session, credential.ID)
	if err != nil || secret.EncryptedSecret != credentialInput.EncryptedSecret {
		t.Fatalf("secret: %+v %v", secret, err)
	}
	foreignSession := Actor{OrganizationID: other, UserID: owner, SessionID: "session_" + owner}
	if _, err := repo.GetStorePublishingCredentialSecret(ctx, foreignSession, credential.ID); err == nil {
		t.Fatal("another workspace read the credential")
	}
	if err := repo.DeleteStorePublishingCredential(ctx, session, credential.ID); err != nil {
		t.Fatalf("delete credential: %v", err)
	}
}

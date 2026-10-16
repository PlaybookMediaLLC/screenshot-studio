package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// A person's edit survives every automated refresh until it is unlocked.
func TestProductProfileKeepsManualEdits(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	text := func(value string) *string { return &value }
	if got, err := repo.GetProductProfile(ctx, owner); err != nil || got != nil {
		t.Fatalf("profile before creation=%+v err=%v", got, err)
	}
	if _, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{Summary: text("Shots")}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("profile without a name and URL: %v", err)
	}
	capabilities := []string{"Capture", "Beautify"}
	created, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{Source: ProfileSourceAutomated,
		Name: text("Acme"), URL: text("https://acme.test"), Audience: text("Clinics"), Capabilities: &capabilities,
		ProofPoints: &[]profile.ProofPoint{{Claim: "10k teams", SourceURL: "https://acme.test/customers"}},
		SourceURLs:  map[string]string{"audience": "https://acme.test/about"}})
	if err != nil || created.Name != "Acme" || created.Provenance["audience"].URL != "https://acme.test/about" ||
		created.Provenance["audience"].EditedByUser || len(created.ProofPoints) != 1 {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	// The founder corrects the audience; a refresh skips it but updates the rest.
	if _, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{Audience: text(" Hospitals ")}); err != nil {
		t.Fatal(err)
	}
	refreshed, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{Source: ProfileSourceAutomated,
		Audience: text("Clinics"), Summary: text("Screenshots for teams")})
	if err != nil || refreshed.Audience != "Hospitals" || !refreshed.Provenance["audience"].EditedByUser ||
		refreshed.Summary != "Screenshots for teams" || refreshed.Provenance["summary"].Source != ProfileSourceAutomated {
		t.Fatalf("refreshed=%+v err=%v", refreshed, err)
	}
	skip, err := w.db.Client.AuditLog.Query().Where(auditlog.OrganizationID(w.org), auditlog.Action("product.product_profile_updated")).
		Order(auditlog.ByCreatedAt()).All(ctx)
	if err != nil || len(skip) != 3 || skip[2].Metadata["skipped"] != "audience" || skip[2].Metadata["changed"] != "summary" {
		t.Fatalf("profile audits=%+v err=%v", skip, err)
	}
	// Unlocked, the field follows the next refresh again.
	if _, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{UnlockFields: []string{"audience"}}); err != nil {
		t.Fatal(err)
	}
	if again, err := repo.UpsertProductProfile(ctx, owner, UpsertProductProfileInput{Source: ProfileSourceAutomated, Audience: text("Clinics")}); err != nil || again.Audience != "Clinics" {
		t.Fatalf("after unlock=%+v err=%v", again, err)
	}
	w.addMember(t, "creator", "creator")
	if _, err := repo.UpsertProductProfile(ctx, w.actor("creator"), UpsertProductProfileInput{Audience: text("Anyone")}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("creator edited the product profile: %v", err)
	}
	if read, err := repo.GetProductProfile(ctx, w.actor("creator")); err != nil || read == nil || read.Audience != "Clinics" {
		t.Fatalf("creator read=%+v err=%v", read, err)
	}
	for name, bad := range map[string]UpsertProductProfileInput{
		"bad source":     {Source: "robot"},
		"bad url":        {URL: text("ftp://acme.test")},
		"unknown field":  {UnlockFields: []string{"secret"}},
		"automated lock": {Source: ProfileSourceAutomated, UnlockFields: []string{"name"}},
	} {
		if _, err := repo.UpsertProductProfile(ctx, owner, bad); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("%s accepted: %v", name, err)
		}
	}
}

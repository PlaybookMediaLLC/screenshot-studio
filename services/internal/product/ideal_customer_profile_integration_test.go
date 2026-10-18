package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// The ICP keeps a person's edits through automated refreshes, records each
// automated value's source and confidence, and is invisible to other workspaces.
func TestIdealCustomerProfileKeepsManualEditsAndStaysInItsWorkspace(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	list := func(values ...string) *[]string { return &values }
	if got, err := repo.GetIdealCustomerProfile(ctx, owner); err != nil || got != nil {
		t.Fatalf("ICP before creation=%+v err=%v", got, err)
	}
	created, err := repo.UpsertIdealCustomerProfile(ctx, owner, UpsertIdealCustomerProfileInput{Source: ProfileSourceAutomated,
		Personas: &[]profile.Persona{{Role: " Agency owner ", TeamSize: "2-10"}}, Pains: list("Chasing late invoices"),
		Confidence: map[string]float64{"pains": 0.7}, SourceURLs: map[string]string{"pains": "https://acme.test/pricing"}})
	if err != nil || created.Personas[0].Role != "Agency owner" || created.Provenance["pains"].Confidence != 0.7 ||
		created.Provenance["pains"].URL != "https://acme.test/pricing" || created.Provenance["pains"].EditedByUser ||
		len(created.Jobs) != 0 || created.Channels == nil {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	// The founder corrects the pains; a refresh skips them but fills the rest.
	if _, err := repo.UpsertIdealCustomerProfile(ctx, owner, UpsertIdealCustomerProfileInput{Pains: list("Cash flow gaps")}); err != nil {
		t.Fatal(err)
	}
	refreshed, err := repo.UpsertIdealCustomerProfile(ctx, owner, UpsertIdealCustomerProfileInput{Source: ProfileSourceAutomated,
		Pains: list("Chasing late invoices"), Channels: list("r/agency")})
	if err != nil || (*refreshed).Pains[0] != "Cash flow gaps" || !refreshed.Provenance["pains"].EditedByUser ||
		refreshed.Channels[0] != "r/agency" || refreshed.Provenance["channels"].Source != ProfileSourceAutomated {
		t.Fatalf("refreshed=%+v err=%v", refreshed, err)
	}
	if _, err := repo.UpsertIdealCustomerProfile(ctx, owner, UpsertIdealCustomerProfileInput{UnlockFields: []string{"pains"}}); err != nil {
		t.Fatal(err)
	}
	if again, err := repo.UpsertIdealCustomerProfile(ctx, owner, UpsertIdealCustomerProfileInput{Source: ProfileSourceAutomated,
		Pains: list("Chasing late invoices")}); err != nil || again.Pains[0] != "Chasing late invoices" {
		t.Fatalf("after unlock=%+v err=%v", again, err)
	}

	w.addMember(t, "viewer", "viewer")
	if _, err := repo.UpsertIdealCustomerProfile(ctx, w.actor("viewer"), UpsertIdealCustomerProfileInput{Pains: list("Anything")}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer edited the ICP: %v", err)
	}
	if read, err := repo.GetIdealCustomerProfile(ctx, w.actor("viewer")); err != nil || read == nil {
		t.Fatalf("viewer read=%+v err=%v", read, err)
	}
	other := newTestWorkspace(t)
	if read, err := other.repo.GetIdealCustomerProfile(ctx, other.owner); err != nil || read != nil {
		t.Fatalf("another workspace read=%+v err=%v", read, err)
	}
	stranger := other.owner
	stranger.OrganizationID = w.org
	if _, err := repo.GetIdealCustomerProfile(ctx, stranger); err == nil {
		t.Fatal("a member of another workspace read this workspace's ICP")
	}

	for name, bad := range map[string]UpsertIdealCustomerProfileInput{
		"bad source":       {Source: "robot"},
		"empty persona":    {Personas: &[]profile.Persona{{Role: " "}}},
		"too many pains":   {Pains: list("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13")},
		"blank channel":    {Channels: list("")},
		"bad confidence":   {Source: ProfileSourceAutomated, Confidence: map[string]float64{"pains": 1.5}},
		"unknown source":   {Source: ProfileSourceAutomated, SourceURLs: map[string]string{"secret": "https://acme.test"}},
		"automated unlock": {Source: ProfileSourceAutomated, UnlockFields: []string{"pains"}},
	} {
		if _, err := repo.UpsertIdealCustomerProfile(ctx, owner, bad); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("%s accepted: %v", name, err)
		}
	}
}

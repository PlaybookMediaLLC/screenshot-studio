package agencies

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/agencies"
)

type sent struct{ to, subject, html string }

type fakeNotifications struct{ emails []sent }

func (f *fakeNotifications) SendEmail(_ context.Context, to, subject, html, _ string) error {
	f.emails = append(f.emails, sent{to, subject, html})
	return nil
}

func TestAgencyNiches(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	t.Setenv("AGENCY_REVIEW_EMAIL", "review@sample.com")
	notifications := &fakeNotifications{}
	s := NewService(NewRepository(client), notifications)
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	user := client.User.Create().SetEmail("owner@x.com").SetProviderName("LOCAL").SetTimezone(0).SaveX(ctx)
	logo := client.Media.Create().SetName("l").SetPath("https://cdn/l.png").SetOrganizationID(org.ID).SaveX(ctx)

	body := dto.CreateAgencyDto{
		Name: "My Agency", Website: "https://a.example", Logo: &dto.CreateAgencyLogoDto{ID: logo.ID, Path: logo.Path},
		ShortDescription: "short", Description: "long", Niches: []string{"Tech", "Art"},
	}
	created, err := s.CreateAgency(ctx, user, body)
	if err != nil {
		t.Fatal(err)
	}
	if len(notifications.emails) != 1 || notifications.emails[0].to != "review@sample.com" ||
		!strings.Contains(notifications.emails[0].html, "/agencies/action/approve/"+created.ID) ||
		!strings.Contains(notifications.emails[0].html, ">Tech,Art</p>") ||
		!strings.Contains(notifications.emails[0].html, `<a href="undefined"`) {
		t.Fatalf("new agency email: %+v", notifications.emails)
	}

	body.Niches = []string{"Art", "Food"}
	again, err := s.CreateAgency(ctx, user, body)
	if err != nil || again.ID != created.ID {
		t.Fatal(again, err)
	}
	agency, err := s.GetAgencyByUser(ctx, user)
	if err != nil || agency == nil {
		t.Fatal(agency, err)
	}
	niches := map[string]bool{}
	for _, n := range agency.Niches {
		niches[n.Niche] = true
	}
	if len(niches) != 2 || !niches["Art"] || !niches["Food"] {
		t.Fatalf("niches: %+v", agency.Niches)
	}
	data, _ := json.Marshal(agency)
	if !strings.Contains(string(data), `"slug":"my-agency"`) || !strings.Contains(string(data), `"niches":[`) || !strings.Contains(string(data), `"logo":{`) {
		t.Fatalf("json: %s", data)
	}

	// not listed until approved
	if list, _ := s.GetAllAgencies(ctx); len(list) != 0 {
		t.Fatal("unapproved agency listed")
	}
	if err := s.ApproveOrDecline(ctx, "admin@x.com", "approve", created.ID); err != nil {
		t.Fatal(err)
	}
	last := notifications.emails[len(notifications.emails)-1]
	if last.to != "owner@x.com" || !strings.Contains(last.html, "Your agency My Agency has been added") || !strings.Contains(last.html, "/agencies/my-agency") {
		t.Fatalf("approve email: %+v", last)
	}
	list, _ := s.GetAllAgencies(ctx)
	info, _ := s.GetAgencyInformation(ctx, "my-agency")
	slugs, _ := s.GetAllAgenciesSlug(ctx)
	count, _ := s.GetCount(ctx)
	if len(list) != 1 || len(list[0].Niches) != 2 || info == nil || len(slugs) != 1 || *slugs[0].Slug != "my-agency" || count != 1 {
		t.Fatalf("approved: %v %v %v %d", list, info, slugs, count)
	}
}

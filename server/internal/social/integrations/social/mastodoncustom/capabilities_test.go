package mastodoncustom

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestLivePublicInstanceCapabilities(t *testing.T) {
	if os.Getenv("MASTODON_LIVE_CAPABILITIES_TEST") != "true" {
		t.Skip("opt-in public metadata check; does not authorize an account")
	}
	capabilities, err := New().instanceCapabilities(context.Background(), "https://mastodon.social")
	if err != nil || capabilities.Validate() != nil {
		t.Fatalf("public instance capabilities could not be verified: %v", err)
	}
}

const instanceFixture = `{"configuration":{
	"statuses":{"max_characters":1024,"max_media_attachments":4,"characters_reserved_per_url":23},
	"media_attachments":{"supported_mime_types":["image/jpeg","image/png","video/mp4"],
	"image_size_limit":16777216,"video_size_limit":103809024,"image_matrix_limit":33177600,
	"video_matrix_limit":8294400,"video_frame_rate_limit":120,"description_limit":1500}}}`

func TestCapabilitiesFailBeforeExchangingCode(t *testing.T) {
	for name, body := range map[string]string{
		"missing configuration": `{}`,
		"missing media limits":  `{"configuration":{"statuses":{"max_characters":500,"max_media_attachments":4,"characters_reserved_per_url":23}}}`,
		"invalid limit type":    strings.Replace(instanceFixture, `"max_characters":1024`, `"max_characters":"1024"`, 1),
		"zero caption limit":    strings.Replace(instanceFixture, `"max_characters":1024`, `"max_characters":0`, 1),
		"unbounded limit":       strings.Replace(instanceFixture, `"image_size_limit":16777216`, `"image_size_limit":999999999999999`, 1),
		"invalid mime":          strings.Replace(instanceFixture, `"image/jpeg"`, `"image/jpeg;token=canary"`, 1),
		"invalid description":   strings.Replace(instanceFixture, `"description_limit":1500`, `"description_limit":-1`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			p := fixtureProvider(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/api/v2/instance" || r.Header.Get("Authorization") != "" {
					t.Fatal("invalid capabilities consumed an OAuth code or received credentials")
				}
				_, _ = io.WriteString(w, body)
			})
			auth, err := p.Authenticate(context.Background(), authParams(), clientInfo("example.social"))
			if auth != nil || err == nil || calls != 1 || strings.Contains(err.Error(), "canary") {
				t.Fatal("incomplete capabilities were accepted or leaked provider data")
			}
		})
	}
}

func TestInstanceCapabilitiesPreserveOptionalLimits(t *testing.T) {
	for _, tc := range []struct {
		name, description string
		known             bool
	}{
		{"older instance", "", false},
		{"unknown description", `,"description_limit":null`, false},
		{"descriptions disabled", `,"description_limit":0`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := fixtureProvider(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.WriteString(w, strings.Replace(instanceFixture, `,"description_limit":1500`, tc.description, 1))
			})
			caps, err := p.instanceCapabilities(context.Background(), "https://example.social")
			if err != nil || (caps.MediaDescriptionLimit != nil) != tc.known || caps.MaxCharacters != 1024 {
				t.Fatalf("optional capability distinction lost: %v", err)
			}
		})
	}
}

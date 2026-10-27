// Package newsletter is the original app's NewsletterService: registers new users with
// Beehiiv or Listmonk when configured.
package newsletter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// Provider is NewsletterInterface.
type Provider interface {
	Name() string
	Register(ctx context.Context, email string) error
}

var providers = []Provider{BeehiivProvider{}, ListmonkProvider{}, EmailEmptyProvider{}}

func find(name string) Provider {
	for _, p := range providers {
		if p.Name() == name {
			return p
		}
	}
	return nil
}

// GetProvider is NewsletterService.getProvider.
func GetProvider() Provider {
	if os.Getenv("BEEHIIVE_API_KEY") != "" {
		return find("beehiiv")
	}
	if os.Getenv("LISTMONK_API_KEY") != "" {
		return find("listmonk")
	}
	return find("empty")
}

// Register is NewsletterService.register.
func Register(ctx context.Context, email string) error {
	if !strings.Contains(email, "@") {
		return nil
	}
	return GetProvider().Register(ctx, email)
}

func postJSON(ctx context.Context, url string, body any, headers map[string]string) (*http.Response, error) {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return http.DefaultClient.Do(req)
}

type BeehiivProvider struct{}

func (BeehiivProvider) Name() string { return "beehiiv" }

func (BeehiivProvider) Register(ctx context.Context, email string) error {
	res, err := postJSON(ctx,
		"https://api.beehiiv.com/v2/publications/"+os.Getenv("BEEHIIVE_PUBLICATION_ID")+"/subscriptions",
		map[string]any{
			"email":               email,
			"reactivate_existing": false,
			"send_welcome_email":  true,
			"utm_source":          "gitroom_platform",
		},
		map[string]string{
			"Content-Type":  "application/json",
			"Accept":        "application/json",
			"Authorization": "Bearer " + os.Getenv("BEEHIIVE_API_KEY"),
		})
	if err != nil {
		return err
	}
	return res.Body.Close()
}

type ListmonkProvider struct{}

func (ListmonkProvider) Name() string { return "listmonk" }

// envNumber is +process.env.X; ok is false for NaN and 0 (filtered out).
func envNumber(key string) (float64, bool) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(raw, 64)
	return n, err == nil && n != 0
}

// Register never fails: Listmonk errors are swallowed like the TS try/catch.
func (ListmonkProvider) Register(ctx context.Context, email string) error {
	lists := []float64{}
	if id, ok := envNumber("LISTMONK_LIST_ID"); ok {
		lists = append(lists, id)
	}
	headers := map[string]string{
		"Content-Type":  "application/json",
		"Accept":        "application/json",
		"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(os.Getenv("LISTMONK_USER")+":"+os.Getenv("LISTMONK_API_KEY"))),
	}

	res, err := postJSON(ctx, os.Getenv("LISTMONK_DOMAIN")+"/api/subscribers", map[string]any{
		"email":  email,
		"status": "enabled",
		"lists":  lists,
	}, headers)
	if err != nil {
		return nil
	}
	var created struct {
		Data *struct {
			ID any `json:"id"`
		} `json:"data"`
	}
	err = json.NewDecoder(res.Body).Decode(&created)
	res.Body.Close()
	if err != nil || created.Data == nil {
		return nil
	}

	// +process.env.LISTMONK_WELCOME_TEMPLATE_ID is NaN (null in JSON) when unset
	var templateID any
	if raw := strings.TrimSpace(os.Getenv("LISTMONK_WELCOME_TEMPLATE_ID")); raw == "" {
		templateID = 0
	} else if n, err := strconv.ParseFloat(raw, 64); err == nil {
		templateID = n
	}
	res, err = postJSON(ctx, os.Getenv("LISTMONK_DOMAIN")+"/api/tx", map[string]any{
		"subscriber_id": created.Data.ID,
		"template_id":   templateID,
		"subject":       "Welcome to Shots 🚀",
	}, headers)
	if err == nil {
		res.Body.Close()
	}
	return nil
}

type EmailEmptyProvider struct{}

func (EmailEmptyProvider) Name() string { return "empty" }

func (EmailEmptyProvider) Register(_ context.Context, email string) error {
	slog.Info("Could have registered to newsletter: " + email)
	return nil
}

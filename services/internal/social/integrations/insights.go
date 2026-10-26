package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
)

// ReadInsightsJSON preserves provider failures without exposing query credentials
// or private response bodies. Successful empty data remains an unavailable metric.
func ReadInsightsJSON(ctx context.Context, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errors.New("invalid insights endpoint")
	}
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return errors.New("provider insights request failed")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("provider insights returned HTTP %d", res.StatusCode)
	}
	const limit = 8 << 20
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil || len(body) > limit {
		return errors.New("invalid insights response size")
	}
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return errors.New("invalid insights response")
	}
	if len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		return errors.New("provider rejected insights request")
	}
	if err := json.Unmarshal(body, out); err != nil {
		return errors.New("invalid insights data")
	}
	return nil
}

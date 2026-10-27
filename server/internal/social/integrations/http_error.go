package integrations

import (
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// HTTPError preserves response status and retry guidance without retaining tokens or response bodies.
type HTTPError struct {
	Status int
	Retry  time.Time
}

func (e *HTTPError) Error() string      { return fmt.Sprintf("provider returned HTTP %d", e.Status) }
func (e *HTTPError) HTTPStatus() int    { return e.Status }
func (e *HTTPError) RetryAt() time.Time { return e.Retry }

// CheckResponse distinguishes an unavailable metric from a failed provider request.
func CheckResponse(response *http.Response) error {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	retry := time.Time{}
	if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds >= 0 {
		retry = time.Now().Add(time.Duration(min(seconds, 86400)) * time.Second)
	} else if date, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil {
		retry = date
	}
	return &HTTPError{Status: response.StatusCode, Retry: retry}
}

package httpx

import (
	"net/http"
	"slices"
	"strings"
)

// CORS returns the backend's CORS options: an origin allow-list,
// credentials unless NOT_SECURED, and the social auth headers.
type CORS struct {
	Origins        []string
	Credentials    bool
	AllowedHeaders []string
	ExposedHeaders []string
}

func (c CORS) Wrap(next http.Handler) http.Handler {
	allowed := strings.Join(c.AllowedHeaders, ",")
	exposed := strings.Join(c.ExposedHeaders, ",")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Like the cors package: Allow-Origin only for a listed origin; Vary,
		// credentials and exposed headers on every response.
		h := w.Header()
		if origin := r.Header.Get("Origin"); origin != "" && slices.Contains(c.Origins, origin) {
			h.Set("Access-Control-Allow-Origin", origin)
		}
		h.Add("Vary", "Origin")
		if c.Credentials {
			h.Set("Access-Control-Allow-Credentials", "true")
		}
		if exposed != "" {
			h.Set("Access-Control-Expose-Headers", exposed)
		}
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
			h.Set("Access-Control-Allow-Headers", allowed)
			h.Set("Content-Length", "0")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

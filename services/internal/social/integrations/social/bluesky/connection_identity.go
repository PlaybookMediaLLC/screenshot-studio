package bluesky

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/instances"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

type didDocument struct {
	ID          string   `json:"id"`
	AlsoKnownAs []string `json:"alsoKnownAs"`
	Service     []struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Endpoint string `json:"serviceEndpoint"`
	} `json:"service"`
}

func (d didDocument) accountServer(did, handle string) (string, error) {
	if d.ID != did || !socialidentity.BlueskyDID(did) {
		return "", errConnection
	}
	// Only the first syntactically valid handle alias is authoritative.
	verifiedHandle := ""
	for _, alias := range d.AlsoKnownAs {
		if strings.HasPrefix(alias, "at://") {
			candidate := strings.TrimPrefix(alias, "at://")
			if normalized, err := socialidentity.BlueskyHandle(candidate); err == nil && normalized == candidate {
				verifiedHandle = candidate
				break
			}
		}
	}
	if handle != "" && verifiedHandle != handle {
		return "", errConnection
	}
	origin := ""
	for _, service := range d.Service {
		if service.ID != "#atproto_pds" && service.ID != did+"#atproto_pds" {
			continue
		}
		candidate, err := instances.Origin(service.Endpoint)
		if err != nil || service.Type != "AtprotoPersonalDataServer" || origin != "" || candidate != strings.TrimSuffix(service.Endpoint, "/") {
			return "", errConnection
		}
		origin = candidate
	}
	if origin == "" {
		return "", errConnection
	}
	return origin, nil
}

func (p *Provider) discoverAccount(ctx context.Context, handle string) (string, string, error) {
	var resolved struct {
		DID string `json:"did"`
	}
	if err := p.connectionJSON(ctx, "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?"+url.Values{"handle": {handle}}.Encode(), &resolved); err != nil || !socialidentity.BlueskyDID(resolved.DID) {
		return "", "", errConnection
	}
	endpoint := "https://plc.directory/" + resolved.DID
	if strings.HasPrefix(resolved.DID, "did:web:") {
		endpoint = "https://" + strings.TrimPrefix(resolved.DID, "did:web:") + "/.well-known/did.json"
	}
	var doc didDocument
	if err := p.connectionJSON(ctx, endpoint, &doc); err != nil {
		return "", "", err
	}
	origin, err := doc.accountServer(resolved.DID, handle)
	return resolved.DID, origin, err
}

func validateSessionDocument(s session, origin, did, handle string) error {
	if s.Did != did {
		return errAccountMismatch
	}
	if handle != "" && s.Handle != handle {
		return errConnection
	}
	var doc didDocument
	if json.Unmarshal(s.DidDoc, &doc) != nil {
		return errConnection
	}
	server, err := doc.accountServer(did, handle)
	if err != nil || server != origin {
		return errConnection
	}
	return nil
}

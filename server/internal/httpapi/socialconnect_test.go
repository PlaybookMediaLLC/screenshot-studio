package httpapi

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialconnect"

// The in-process connector must keep every optional connection capability the
// handlers type-assert on the verifier.
var _ interface {
	DestinationVerifier
	socialOAuthExchanger
	xIdentityVerifier
	blueskyConnector
	destinationProfiles
	connectionAvailabilityReader
} = (*socialconnect.Connector)(nil)

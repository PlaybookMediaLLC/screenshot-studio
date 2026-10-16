// Package profile holds the JSON shapes stored on a workspace's product
// profile (docs/rfcs/012-product-intelligence.md).
package profile

import "time"

// ProofPoint is a claim about the product and where it came from.
type ProofPoint struct {
	Claim     string `json:"claim"`
	SourceURL string `json:"sourceUrl,omitempty"`
}

// FieldProvenance records where a profile field's value came from. A field a
// person edited is locked: automated updates skip it until it is unlocked.
type FieldProvenance struct {
	EditedByUser bool      `json:"editedByUser"`
	Source       string    `json:"source"`
	UpdatedAt    time.Time `json:"updatedAt"`
	URL          string    `json:"url,omitempty"`
}

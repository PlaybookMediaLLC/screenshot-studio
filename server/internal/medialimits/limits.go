// Package medialimits shares upload ceilings with the web. Provider limits are
// checked separately; a Shots subscription never grants a social entitlement.
package medialimits

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed limits.json
var document []byte

// ImageProfile defines persisted static-image derivatives; MaxEdge is the
// application's conservative processing size, not an account entitlement.
type ImageProfile struct {
	MaxBytes int      `json:"maxBytes"`
	MaxEdge  int      `json:"maxEdge"`
	Formats  []string `json:"formats"`
}

var Limits struct {
	ImageProfiles  map[string]ImageProfile `json:"imageProfiles"`
	FreeImageBytes int                     `json:"freeImageBytes"`
	PaidImageBytes int                     `json:"paidImageBytes"`
	VideoBytes     int                     `json:"videoBytes"`
	PDFBytes       int                     `json:"pdfBytes"`
	OtherBytes     int                     `json:"otherBytes"`
	ImagePixels    int                     `json:"imagePixels"`
	PDFPages       int                     `json:"pdfPages"`
}

func init() {
	if err := json.Unmarshal(document, &Limits); err != nil {
		panic(err)
	}
}

// UploadBytes is the ingestion ceiling, independent of publication eligibility.
func UploadBytes(mime, plan string) int {
	if strings.HasPrefix(mime, "image/") {
		if plan == "pro" || plan == "business" || plan == "enterprise" {
			return Limits.PaidImageBytes
		}
		return Limits.FreeImageBytes
	}
	if strings.HasPrefix(mime, "video/") {
		return Limits.VideoBytes
	}
	if mime == "application/pdf" {
		return Limits.PDFBytes
	}
	return Limits.OtherBytes
}

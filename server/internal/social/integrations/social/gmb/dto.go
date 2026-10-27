package gmb

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

// SettingsDTO is GmbSettingsDto.
type SettingsDTO struct {
	TopicType        *string `json:"topicType,omitempty"`
	CallToActionType *string `json:"callToActionType,omitempty"`
	CallToActionURL  *string `json:"callToActionUrl,omitempty"`
	// Event-specific fields
	EventTitle     string `json:"eventTitle,omitempty"`
	EventStartDate string `json:"eventStartDate,omitempty"`
	EventEndDate   string `json:"eventEndDate,omitempty"`
	EventStartTime string `json:"eventStartTime,omitempty"`
	EventEndTime   string `json:"eventEndTime,omitempty"`
	// Offer-specific fields
	OfferCouponCode string `json:"offerCouponCode,omitempty"`
	OfferRedeemURL  string `json:"offerRedeemUrl,omitempty"`
	OfferTerms      string `json:"offerTerms,omitempty"`
}

var (
	topicTypes        = []string{"STANDARD", "EVENT", "OFFER"}
	callToActionTypes = []string{"NONE", "BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "CALL"}
)

// Validate reproduces class-validator in declaration order.
func (d *SettingsDTO) Validate() []string {
	var out []string
	if d.TopicType != nil && !oneOf(*d.TopicType, topicTypes) {
		out = append(out, "topicType must be one of the following values: "+strings.Join(topicTypes, ", "))
	}
	if d.CallToActionType != nil && !oneOf(*d.CallToActionType, callToActionTypes) {
		out = append(out, "callToActionType must be one of the following values: "+strings.Join(callToActionTypes, ", "))
	}
	if d.CallToActionURL != nil && d.CallToActionType != nil && *d.CallToActionType != "" && !isURL(*d.CallToActionURL) {
		out = append(out, "callToActionUrl must be a URL address")
	}
	if d.OfferRedeemURL != "" && !isURL(d.OfferRedeemURL) {
		out = append(out, "offerRedeemUrl must be a URL address")
	}
	return out
}

func oneOf(value string, allowed []string) bool {
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

var (
	tldPattern   = regexp.MustCompile(`(?i)^([a-z\p{L}]{2,}|xn--[a-z0-9-]{2,})$`)
	labelPattern = regexp.MustCompile(`(?i)^[a-z0-9\p{L}]([a-z0-9\p{L}-]{0,61}[a-z0-9\p{L}])?$`)
)

// isURL approximates class-validator's @IsUrl() (validator.js isURL with
// default options: protocol optional, http/https/ftp, TLD required unless the
// host is an IP).
func isURL(value string) bool {
	if value == "" || len(value) >= 2083 || strings.ContainsAny(value, " \t\r\n<>") || strings.HasPrefix(value, "//") {
		return false
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ftp") {
		return false
	}
	host := u.Hostname()
	if net.ParseIP(host) != nil {
		return true
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 || !tldPattern.MatchString(labels[len(labels)-1]) {
		return false
	}
	for _, label := range labels {
		if !labelPattern.MatchString(label) {
			return false
		}
	}
	return true
}

// Package billing holds Postiz's dtos/billing. Validate returns the
// ValidationPipe messages in class-validator order; empty means valid.
package billing

import (
	"fmt"
	"math"
	"strings"
)

// AdminApplyCouponDto is admin.apply.coupon.dto.ts. Months is a float so a
// fractional value fails IsInt like in Nest.
type AdminApplyCouponDto struct {
	Type   *string  `json:"type"`
	Value  *float64 `json:"value"`
	Months *float64 `json:"months"`
}

func (d *AdminApplyCouponDto) Validate() []string {
	var out []string
	out = append(out, isIn("type", d.Type, "percentage", "amount")...)
	if d.Type == nil {
		out = append(out, "type must be a string")
	}
	if d.Value == nil {
		out = append(out, "value should not be null or undefined")
	}
	if d.Value == nil || *d.Value < 1 {
		out = append(out, "value must not be less than 1")
	}
	if d.Value == nil {
		out = append(out, "value must be a number conforming to the specified constraints")
	}
	if d.Months == nil {
		out = append(out, "months should not be null or undefined")
	}
	if d.Months == nil || *d.Months > 12 {
		out = append(out, "months must not be greater than 12")
	}
	if d.Months == nil || *d.Months < 1 {
		out = append(out, "months must not be less than 1")
	}
	if d.Months == nil || *d.Months != math.Trunc(*d.Months) {
		out = append(out, "months must be an integer number")
	}
	return out
}

// BillingSubscribeDto is billing.subscribe.dto.ts.
type BillingSubscribeDto struct {
	Period            string `json:"period"`
	Billing           string `json:"billing"`
	Utm               string `json:"utm"`
	Dub               string `json:"dub"`
	DatafastSessionID string `json:"datafast_session_id"`
	DatafastVisitorID string `json:"datafast_visitor_id"`
}

func (d *BillingSubscribeDto) Validate() []string {
	var out []string
	out = append(out, isIn("period", &d.Period, "MONTHLY", "YEARLY")...)
	out = append(out, isIn("billing", &d.Billing, "STANDARD", "PRO", "TEAM", "ULTIMATE")...)
	return out
}

// BillingSyncDto is billing.sync.dto.ts.
type BillingSyncDto struct {
	Provider *string `json:"provider"`
}

func (d *BillingSyncDto) Validate() []string {
	if d.Provider == nil {
		return []string{"provider should not be null or undefined", "provider must be a string"}
	}
	return nil
}

// ResetCreditsDto is reset.credits.dto.ts.
type ResetCreditsDto struct {
	Type *string `json:"type"`
}

func (d *ResetCreditsDto) Validate() []string {
	out := isIn("type", d.Type, "ai_images", "ai_videos")
	if d.Type == nil {
		out = append(out, "type must be a string")
	}
	return out
}

func isIn(field string, v *string, values ...string) []string {
	if v != nil {
		for _, allowed := range values {
			if *v == allowed {
				return nil
			}
		}
	}
	return []string{fmt.Sprintf("%s must be one of the following values: %s", field, strings.Join(values, ", "))}
}

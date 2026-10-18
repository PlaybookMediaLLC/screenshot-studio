package billing

import (
	"reflect"
	"testing"
)

func TestAdminApplyCouponDto(t *testing.T) {
	typ, value, months := "amount", 5.0, 1.5
	got := (&AdminApplyCouponDto{Type: &typ, Value: &value, Months: &months}).Validate()
	if !reflect.DeepEqual(got, []string{"months must be an integer number"}) {
		t.Errorf("got %q", got)
	}
	if got := (&BillingSubscribeDto{Period: "MONTHLY", Billing: "FREE"}).Validate(); !reflect.DeepEqual(got, []string{"billing must be one of the following values: STANDARD, PRO, TEAM, ULTIMATE"}) {
		t.Errorf("got %q", got)
	}
}

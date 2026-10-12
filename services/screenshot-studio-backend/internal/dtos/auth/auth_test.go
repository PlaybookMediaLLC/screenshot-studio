package auth

import (
	"reflect"
	"testing"
)

func ptr(s string) *string { return &s }

func TestCreateOrgUserDtoMessages(t *testing.T) {
	got := (&CreateOrgUserDto{}).Validate()
	want := []string{
		"password should not be null or undefined",
		"password must be shorter than or equal to 64 characters",
		"password must be longer than or equal to 3 characters",
		"password must be a string",
		"provider should not be null or undefined",
		"provider must be a string",
		"providerToken should not be null or undefined",
		"providerToken must be a string",
		"email should not be null or undefined",
		"email must be an email",
		"company should not be null or undefined",
		"company must be shorter than or equal to 128 characters",
		"company must be longer than or equal to 3 characters",
		"company must be a string",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %q", got)
	}

	// An OAuth sign up skips password and email.
	oauth := &CreateOrgUserDto{Provider: ptr("GITHUB"), ProviderToken: ptr("tok"), Company: ptr("Acme")}
	if msgs := oauth.Validate(); len(msgs) != 0 {
		t.Errorf("oauth %q", msgs)
	}
	local := &CreateOrgUserDto{Provider: ptr("LOCAL"), Password: ptr("pw"), Email: ptr("nope"), Company: ptr("Acme")}
	if msgs := local.Validate(); !reflect.DeepEqual(msgs, []string{"password must be longer than or equal to 3 characters", "email must be an email"}) {
		t.Errorf("local %q", msgs)
	}
}

func TestForgotReturnPasswordDto(t *testing.T) {
	same := &ForgotReturnPasswordDto{Password: ptr("abcd"), RepeatPassword: ptr("abcd"), Token: ptr("12345")}
	if msgs := same.Validate(); len(msgs) != 0 {
		t.Errorf("same %q", msgs)
	}
	diff := &ForgotReturnPasswordDto{Password: ptr("abcd"), RepeatPassword: ptr("abce"), Token: ptr("12345")}
	if msgs := diff.Validate(); !reflect.DeepEqual(msgs, []string{"Passwords do not match"}) {
		t.Errorf("diff %q", msgs)
	}
}

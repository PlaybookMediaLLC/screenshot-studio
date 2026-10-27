// Package auth holds the auth request bodies. Each DTO's Validate returns the
// validation messages in the API's format (class-validator order: IsDefined
// first, then the remaining decorators bottom-up); an empty result means valid.
// Controllers decode with c.Decode and answer httpx.BadRequest(msgs) when
// Validate returns anything.
package auth

import (
	"fmt"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// CreateOrgUserDto is the create org user request body.
type CreateOrgUserDto struct {
	Password          *string `json:"password"`
	Provider          *string `json:"provider"`
	ProviderToken     *string `json:"providerToken"`
	Email             *string `json:"email"`
	Company           *string `json:"company"`
	DatafastVisitorID string  `json:"datafast_visitor_id"`

	// ProviderID is the `& { providerId?: string }` the auth service adds for
	// OAuth sign ups; it never comes from the request body.
	ProviderID string `json:"-"`
}

func (d *CreateOrgUserDto) Validate() []string {
	var out []string
	if empty(d.ProviderToken) {
		out = append(out, definedString("password", d.Password)...)
		out = append(out, maxLength("password", d.Password, 64)...)
		out = append(out, minLength("password", d.Password, 3)...)
		out = append(out, isString("password", d.Password)...)
	}
	out = append(out, definedString("provider", d.Provider)...)
	out = append(out, isString("provider", d.Provider)...)
	if empty(d.Password) {
		out = append(out, definedString("providerToken", d.ProviderToken)...)
		out = append(out, isString("providerToken", d.ProviderToken)...)
	}
	if empty(d.ProviderToken) {
		out = append(out, definedString("email", d.Email)...)
		out = append(out, isEmail("email", d.Email)...)
	}
	out = append(out, definedString("company", d.Company)...)
	out = append(out, maxLength("company", d.Company, 128)...)
	out = append(out, minLength("company", d.Company, 3)...)
	out = append(out, isString("company", d.Company)...)
	return out
}

// LoginUserDto is the login user request body.
type LoginUserDto struct {
	Password          *string `json:"password"`
	Provider          *string `json:"provider"`
	ProviderToken     *string `json:"providerToken"`
	Email             *string `json:"email"`
	DatafastVisitorID string  `json:"datafast_visitor_id"`
}

func (d *LoginUserDto) Validate() []string {
	var out []string
	if empty(d.ProviderToken) {
		out = append(out, definedString("password", d.Password)...)
		out = append(out, minLength("password", d.Password, 3)...)
		out = append(out, isString("password", d.Password)...)
	}
	out = append(out, definedString("provider", d.Provider)...)
	out = append(out, isString("provider", d.Provider)...)
	if empty(d.Password) {
		out = append(out, definedString("providerToken", d.ProviderToken)...)
		out = append(out, isString("providerToken", d.ProviderToken)...)
	}
	out = append(out, definedString("email", d.Email)...)
	out = append(out, isEmail("email", d.Email)...)
	return out
}

// ForgotReturnPasswordDto is the forgot return password request body. repeatPassword is
// only validated when it differs from password, and then always fails its
// IsIn([makeId(10)]) check with "Passwords do not match".
type ForgotReturnPasswordDto struct {
	Password       *string `json:"password"`
	RepeatPassword *string `json:"repeatPassword"`
	Token          *string `json:"token"`
}

func (d *ForgotReturnPasswordDto) Validate() []string {
	var out []string
	out = append(out, definedString("password", d.Password)...)
	out = append(out, minLength("password", d.Password, 3)...)
	out = append(out, isString("password", d.Password)...)
	if !sameString(d.Password, d.RepeatPassword) {
		out = append(out, definedString("repeatPassword", d.RepeatPassword)...)
		out = append(out, "Passwords do not match")
		out = append(out, isString("repeatPassword", d.RepeatPassword)...)
	}
	out = append(out, definedString("token", d.Token)...)
	out = append(out, minLength("token", d.Token, 5)...)
	out = append(out, isString("token", d.Token)...)
	return out
}

// ForgotPasswordDto is the forgot password request body.
type ForgotPasswordDto struct {
	Email *string `json:"email"`
}

func (d *ForgotPasswordDto) Validate() []string { return emailOnly(d.Email) }

// ResendActivationDto is the resend activation request body.
type ResendActivationDto struct {
	Email *string `json:"email"`
}

func (d *ResendActivationDto) Validate() []string { return emailOnly(d.Email) }

// emailOnly is `@IsString() @IsDefined() @IsEmail() email`.
func emailOnly(email *string) []string {
	var out []string
	out = append(out, definedString("email", email)...)
	out = append(out, isEmail("email", email)...)
	out = append(out, isString("email", email)...)
	return out
}

func empty(v *string) bool { return v == nil || *v == "" }

func sameString(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// jsLength counts UTF-16 code units like String.prototype.length.
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }

func definedString(field string, v *string) []string {
	if v == nil {
		return []string{field + " should not be null or undefined"}
	}
	return nil
}

func isString(field string, v *string) []string {
	if v == nil {
		return []string{field + " must be a string"}
	}
	return nil
}

func minLength(field string, v *string, n int) []string {
	if v == nil || jsLength(*v) < n {
		return []string{fmt.Sprintf("%s must be longer than or equal to %d characters", field, n)}
	}
	return nil
}

func maxLength(field string, v *string, n int) []string {
	if v == nil || jsLength(*v) > n {
		return []string{fmt.Sprintf("%s must be shorter than or equal to %d characters", field, n)}
	}
	return nil
}

func isEmail(field string, v *string) []string {
	if v == nil || httpx.Validator().Var(*v, "email") != nil {
		return []string{field + " must be an email"}
	}
	return nil
}

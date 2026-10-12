// Package settings holds Postiz's dtos/settings. Validate returns the
// ValidationPipe messages in class-validator order; empty means valid.
package settings

import "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"

const roleMessage = "role must be one of the following values: USER, ADMIN"

// AddTeamMemberDto is add.team.member.dto.ts. Email is only validated when
// SendEmail is true.
type AddTeamMemberDto struct {
	Email     *string `json:"email"`
	Role      *string `json:"role"`
	SendEmail *bool   `json:"sendEmail"`
}

func (d *AddTeamMemberDto) Validate() []string {
	var out []string
	if d.SendEmail != nil && *d.SendEmail {
		out = append(out, email(d.Email)...)
	}
	out = append(out, role(d.Role)...)
	if d.SendEmail == nil {
		out = append(out, "sendEmail should not be null or undefined", "sendEmail must be a boolean value")
	}
	return out
}

// AdminAddTeamMemberDto is admin.add.team.member.dto.ts.
type AdminAddTeamMemberDto struct {
	Email *string `json:"email"`
	Role  *string `json:"role"`
}

func (d *AdminAddTeamMemberDto) Validate() []string {
	return append(email(d.Email), role(d.Role)...)
}

// ShortlinkPreferenceDto is shortlink-preference.dto.ts.
type ShortlinkPreferenceDto struct {
	Shortlink string `json:"shortlink"`
}

func (d *ShortlinkPreferenceDto) Validate() []string {
	switch d.Shortlink {
	case "ASK", "YES", "NO":
		return nil
	}
	return []string{"shortlink must be one of the following values: ASK, YES, NO"}
}

// email is `@IsDefined() @IsEmail()`.
func email(v *string) []string {
	if v == nil {
		return []string{"email should not be null or undefined", "email must be an email"}
	}
	if httpx.Validator().Var(*v, "email") != nil {
		return []string{"email must be an email"}
	}
	return nil
}

// role is `@IsString() @IsIn(['USER', 'ADMIN'])`.
func role(v *string) []string {
	if v == nil {
		return []string{roleMessage, "role must be a string"}
	}
	if *v != "USER" && *v != "ADMIN" {
		return []string{roleMessage}
	}
	return nil
}

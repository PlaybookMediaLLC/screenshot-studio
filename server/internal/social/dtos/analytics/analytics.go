// Package analytics holds the original app's dtos/analytics. Both are query DTOs: bind
// with c.BindQuery, then call Validate (ValidationPipe messages, empty means
// valid).
package analytics

import "regexp"

// GetOrgActivityDto is the get org activity request body.
type GetOrgActivityDto struct {
	From *string `json:"from" query:"from"`
	To   *string `json:"to" query:"to"`
}

func (d *GetOrgActivityDto) Validate() []string {
	var out []string
	if d.From != nil && !IsISO8601(*d.From) {
		out = append(out, "from must be a valid ISO 8601 date string")
	}
	if d.To != nil && !IsISO8601(*d.To) {
		out = append(out, "to must be a valid ISO 8601 date string")
	}
	return out
}

// StarsListDto is the stars list request body.
type StarsListDto struct {
	Page  *int    `json:"page" query:"page"`
	Key   *string `json:"key" query:"key"`
	State *string `json:"state" query:"state"`
}

func (d *StarsListDto) Validate() []string {
	var out []string
	if d.Page == nil {
		out = append(out, "page should not be null or undefined", "page must be a number conforming to the specified constraints")
	}
	if d.Key != nil {
		switch *d.Key {
		case "login", "totalStars", "stars", "date", "forks", "totalForks":
		default:
			out = append(out, "key must be one of the following values: login, totalStars, stars, date, forks, totalForks")
		}
	}
	if d.State != nil && *d.State != "desc" && *d.State != "asc" {
		out = append(out, "state must be one of the following values: desc, asc")
	}
	return out
}

// iso8601 is validator.js's isISO8601 pattern without the lookahead and
// backreferences RE2 lacks (calendar dates, week dates, ordinal dates, with
// optional time and offset).
var iso8601 = regexp.MustCompile(`^[+-]?\d{4}(-?(0[1-9]|1[0-2])(-?([12]\d|0[1-9]|3[01]))?|-?W([0-4]\d|5[0-3])(-?[1-7])?|-?(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))?([T\s](([01]\d|2[0-3])(:?[0-5]\d)?|24:?00)([.,]\d+)?(:?[0-5]\d([.,]\d+)?)?([zZ]|[+-]([01]\d|2[0-3]):?([0-5]\d)?)?)?$`)

// IsISO8601 is class-validator's IsDateString check.
func IsISO8601(value string) bool { return iso8601.MatchString(value) }

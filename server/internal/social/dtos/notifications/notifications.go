// Package notifications holds the original app's dtos/notifications.
package notifications

// GetNotificationsDto is the get notifications request body, a query DTO: bind it with
// c.BindQuery (which rejects a non-numeric page with the IsNumber message),
// then call Validate. Page defaults to 0.
type GetNotificationsDto struct {
	Page int `json:"page" query:"page"`
}

func (d *GetNotificationsDto) Validate() []string {
	if d.Page < 0 {
		return []string{"page must not be less than 0"}
	}
	return nil
}

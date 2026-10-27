package socialidentity

import "time"

// Connection is a credential-free account snapshot read through its tenant API.
// NativeID is provider identity; ID is the durable social adapter connection ID.
type Connection struct {
	ID           string        `json:"id"`
	Provider     string        `json:"provider"`
	NativeID     string        `json:"nativeId"`
	Name         string        `json:"name"`
	Handle       string        `json:"handle"`
	AvatarURL    string        `json:"avatarUrl"`
	Active       bool          `json:"active"`
	Verification *Verification `json:"verification"`
	VerifiedAt   *time.Time    `json:"verifiedAt"`
}

// Validate requires a complete provider proof for this exact destination.
func (c *Connection) Validate(provider, id string) error {
	if c == nil || c.ID == "" || c.ID != id || c.Provider != provider || c.VerifiedAt == nil || c.Verification == nil || !c.Active ||
		len(c.Name) > 500 || len(c.Handle) > 500 || len(c.AvatarURL) > 2048 {
		return ErrInvalid
	}
	return c.Verification.Validate(provider, c.NativeID)
}

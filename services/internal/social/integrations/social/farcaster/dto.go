package farcaster

// Farcaster post settings. A missing and a null nested
// value both decode to nil, so both are treated as undefined (skipped by
// @ValidateNested); a wrong JSON type fails decoding.

type FarcasterID struct {
	ID *string `json:"id,omitempty"`
}

type FarcasterValue struct {
	Value *FarcasterID `json:"value,omitempty"`
}

type FarcasterDTO struct {
	Subreddit []*FarcasterValue `json:"subreddit,omitempty"`
}

// Validate returns class-validator's constraint messages in the order
// posts.service's firstValidationError walks them (the first one is shown).
func (d *FarcasterDTO) Validate() []string {
	var out []string
	for _, item := range d.Subreddit {
		if item == nil {
			out = append(out, "nested property subreddit must be either object or array")
			continue
		}
		if item.Value != nil && item.Value.ID == nil {
			out = append(out, "id must be a string")
		}
	}
	return out
}

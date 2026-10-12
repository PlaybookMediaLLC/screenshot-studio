// Package agencies holds Postiz's dtos/agencies.
package agencies

type CreateAgencyLogoDto struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

// CreateAgencyDto: logo has no @ValidateNested in Postiz, so its fields are
// not validated. Facebook, LinkedIn and YouTube are only checked when set
// (@ValidateIf(o => o.facebook)).
type CreateAgencyDto struct {
	Name             string               `json:"name" validate:"min=3"`
	Website          string               `json:"website" validate:"required,url"`
	Facebook         string               `json:"facebook,omitempty" validate:"omitempty,url"`
	Instagram        *string              `json:"instagram,omitempty"`
	Twitter          *string              `json:"twitter,omitempty"`
	LinkedIn         string               `json:"linkedIn,omitempty" validate:"omitempty,url"`
	Youtube          string               `json:"youtube,omitempty" validate:"omitempty,url"`
	Tiktok           *string              `json:"tiktok,omitempty"`
	Logo             *CreateAgencyLogoDto `json:"logo"`
	ShortDescription string               `json:"shortDescription"`
	Description      string               `json:"description"`
	Niches           []string             `json:"niches" validate:"min=1,max=3,dive,oneof='Real Estate' Fashion 'Health and Fitness' Beauty Travel Food Tech Gaming Parenting Education Business Finance DIY Pets Lifestyle Sports Entertainment Art Photography Sustainability"`
}

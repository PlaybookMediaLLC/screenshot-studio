// Package generator holds the post generator request bodies.
package generator

type InnerPost struct {
	Post string `json:"post" validate:"required"`
}

type PostGroup struct {
	List []InnerPost `json:"list" validate:"required,min=1,dive"`
}

type CreateGeneratedPostsDto struct {
	Posts []PostGroup `json:"posts" validate:"required,min=1,dive"`
	Week  int         `json:"week" validate:"required"`
	Year  int         `json:"year" validate:"required"`
	// @ValidateIf((o) => !o.url) on both: an empty url fails itself, and
	// postId is then checked too.
	URL    string `json:"url" validate:"required"`
	PostID string `json:"postId" validate:"required_without=URL"`
}

type GeneratorDto struct {
	Research  string `json:"research" validate:"min=10"`
	IsPicture bool   `json:"isPicture"`
	Format    string `json:"format" validate:"oneof=one_short one_long thread_short thread_long"`
	Tone      string `json:"tone" validate:"oneof=personal company"`
}

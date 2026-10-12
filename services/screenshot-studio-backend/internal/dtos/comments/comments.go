// Package comments ports libraries/nestjs-libraries/src/dtos/comments.
package comments

type AddCommentDto struct {
	Content string `json:"content" validate:"min=1,max=2000"`
}

type CreatePublicCommentDto struct {
	Content        string  `json:"content" validate:"min=1,max=2000"`
	PostID         string  `json:"postId,omitempty"`
	AnchorStart    *int    `json:"anchorStart,omitempty" validate:"omitempty,min=0"`
	AnchorEnd      *int    `json:"anchorEnd,omitempty" validate:"omitempty,min=0"`
	AnchorQuote    *string `json:"anchorQuote,omitempty" validate:"omitempty,max=500"`
	ParentID       string  `json:"parentId,omitempty"`
	DisplayName    *string `json:"displayName,omitempty" validate:"omitempty,min=1,max=80"`
	RecaptchaToken string  `json:"recaptchaToken,omitempty"`
}

type ResolveCommentDto struct {
	Resolved bool `json:"resolved"`
}

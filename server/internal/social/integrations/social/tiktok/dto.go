package tiktok

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// TikTokMusic is the music choice in the TikTok post settings.
type TikTokMusic struct {
	ID     *string `json:"id" jsonschema_description:"The commercial music library track id, taken from the \"id\" returned by the musicSearch function."`
	Title  *string `json:"title,omitempty"`
	Artist *string `json:"artist,omitempty"`
	Image  *string `json:"image,omitempty"`
	// AudioVolume / VideoVolume carry @Type(() => Number): read them with ToNumber.
	AudioVolume any `json:"audio_volume,omitempty"`
	VideoVolume any `json:"video_volume,omitempty"`
}

// TikTokLocation is the location in the TikTok post settings.
type TikTokLocation struct {
	ID      *string `json:"id" jsonschema_description:"The location tag id, taken from the \"id\" returned by the locationSearch function."`
	Name    *string `json:"name"`
	Address *string `json:"address,omitempty"`
}

// TikTokDTO is the settings DTO shared by tiktok and tiktok-business.
//
// TikTok only honors most of these settings on a DIRECT_POST. With
// content_posting_method=UPLOAD the media lands in the user's TikTok inbox as a
// draft, and TikTok's inbox/upload endpoints accept nothing but the title /
// description - every other field below is silently discarded.
// video_made_with_ai / duet / stitch are additionally video-only: TikTok's photo
// post_info has no is_aigc, disable_duet or disable_stitch field.
// music / location are TikTok Business only: the legacy TikTok provider ignores
// them (its Content Posting API has no music_sound_info / location fields).
// Fields stay required here (existing clients depend on it); the constraints are
// documented, not enforced.
//
// Boolean fields are `any`: stored settings may hold "true"/"false" strings,
// which the providers read with integrations.AssetBoolean and Validate rejects
// like class-validator's @IsBoolean.
type TikTokDTO struct {
	Title                string          `json:"title" jsonschema_description:"Used as the title of the post. The only setting TikTok keeps when content_posting_method=UPLOAD."`
	PrivacyLevel         *string         `json:"privacy_level" jsonschema_description:"Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD."`
	Duet                 any             `json:"duet" jsonschema_description:"Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no duet setting for photo posts."`
	Stitch               any             `json:"stitch" jsonschema_description:"Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no stitch setting for photo posts."`
	Comment              any             `json:"comment" jsonschema_description:"Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD."`
	AutoAddMusic         *string         `json:"autoAddMusic" jsonschema_description:"Photo posts only, and only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD. On TikTok Business, \"yes\" attaches a random commercial music library track and overrides the music setting; on legacy TikTok, \"yes\" lets TikTok auto-add its recommended music."`
	BrandContentToggle   any             `json:"brand_content_toggle" jsonschema_description:"Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD."`
	VideoMadeWithAI      any             `json:"video_made_with_ai,omitempty" jsonschema_description:"Labels the post as AI generated. Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no AI-generated label for photo posts, and discards it on UPLOAD."`
	BrandOrganicToggle   any             `json:"brand_organic_toggle" jsonschema_description:"Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD."`
	Music                *TikTokMusic    `json:"music,omitempty" jsonschema_description:"TikTok Business only, and only when content_posting_method=DIRECT_POST. Attaches a commercial music library track to the post (use the musicSearch function to find one). audio_volume / video_volume apply to video posts only. For photos, ignored when autoAddMusic is \"yes\" (a random track is attached instead)."`
	Location             *TikTokLocation `json:"location,omitempty" jsonschema_description:"TikTok Business only, and only when content_posting_method=DIRECT_POST. Tags the post with a location (use the locationSearch function to find one)."`
	ContentPostingMethod *string         `json:"content_posting_method" jsonschema_description:"Required. Use \"DIRECT_POST\" to actually publish the post to TikTok. \"UPLOAD\" does NOT publish: it only sends the media to the user's TikTok app inbox, where they must manually finish and publish it within 24 hours or it is discarded, and it makes TikTok ignore every other setting here. Only use \"UPLOAD\" when the user explicitly asks to review or edit the post inside the TikTok app before publishing."`
}

// Validate reproduces the class-validator decorators, messages in declaration
// order (within a property: @IsDefined first, then bottom-up decorator order;
// nested messages prefixed with the parent property).
func (d *TikTokDTO) Validate() []string {
	var errs []string
	// @ValidateIf((p) => p.title) @MaxLength(90)
	if d.Title != "" && jsLength(d.Title) > 90 {
		errs = append(errs, "title must be shorter than or equal to 90 characters")
	}
	errs = append(errs, stringIn("privacy_level", d.PrivacyLevel, "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY")...)
	errs = append(errs, boolean("duet", d.Duet)...)
	errs = append(errs, boolean("stitch", d.Stitch)...)
	errs = append(errs, boolean("comment", d.Comment)...)
	if d.AutoAddMusic == nil || (*d.AutoAddMusic != "yes" && *d.AutoAddMusic != "no") {
		errs = append(errs, "autoAddMusic must be one of the following values: yes, no")
	}
	errs = append(errs, boolean("brand_content_toggle", d.BrandContentToggle)...)
	if d.VideoMadeWithAI != nil {
		errs = append(errs, boolean("video_made_with_ai", d.VideoMadeWithAI)...)
	}
	errs = append(errs, boolean("brand_organic_toggle", d.BrandOrganicToggle)...)
	if m := d.Music; m != nil {
		errs = append(errs, defined("music.id", m.ID)...)
		errs = append(errs, volume("music.audio_volume", m.AudioVolume)...)
		errs = append(errs, volume("music.video_volume", m.VideoVolume)...)
	}
	if l := d.Location; l != nil {
		errs = append(errs, defined("location.id", l.ID)...)
		errs = append(errs, defined("location.name", l.Name)...)
	}
	errs = append(errs, stringIn("content_posting_method", d.ContentPostingMethod, "DIRECT_POST", "UPLOAD")...)
	return errs
}

// @IsIn([...]) @IsString()
func stringIn(name string, value *string, allowed ...string) []string {
	var errs []string
	if value == nil {
		errs = append(errs, name+" must be a string")
	}
	for _, a := range allowed {
		if value != nil && *value == a {
			return errs
		}
	}
	return append(errs, name+" must be one of the following values: "+strings.Join(allowed, ", "))
}

// @IsBoolean()
func boolean(name string, value any) []string {
	if _, ok := value.(bool); ok {
		return nil
	}
	return []string{name + " must be a boolean value"}
}

// @IsDefined() @IsString()
func defined(name string, value *string) []string {
	if value != nil {
		return nil
	}
	return []string{name + " should not be null or undefined", name + " must be a string"}
}

// @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
func volume(name string, value any) []string {
	if value == nil {
		return nil
	}
	n := ToNumber(value)
	var errs []string
	if !(n <= 100) {
		errs = append(errs, name+" must not be greater than 100")
	}
	if !(n >= 0) {
		errs = append(errs, name+" must not be less than 0")
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		errs = append(errs, name+" must be a number conforming to the specified constraints")
	}
	return errs
}

// ToNumber is JavaScript's Number(value), as applied by @Type(() => Number)
// and the unary `+` the providers use on music volumes.
func ToNumber(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case bool:
		if v {
			return 1
		}
		return 0
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return math.NaN()
		}
		return n
	}
	return math.NaN()
}

// jsLength is validator.js isLength's count: surrogate pairs and variation
// selectors count once.
func jsLength(s string) int {
	return utf8.RuneCountInString(s) - strings.Count(s, "️") - strings.Count(s, "︎")
}

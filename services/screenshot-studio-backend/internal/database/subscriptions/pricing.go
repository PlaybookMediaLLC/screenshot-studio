package subscriptions

// PricingInner is PricingInnerInterface (subscriptions/pricing.ts).
type PricingInner struct {
	Current              string `json:"current"`
	MonthPrice           int    `json:"month_price"`
	YearPrice            int    `json:"year_price"`
	Channel              int    `json:"channel"`
	PostsPerMonth        int    `json:"posts_per_month"`
	TeamMembers          bool   `json:"team_members"`
	CommunityFeatures    bool   `json:"community_features"`
	FeaturedByGitroom    bool   `json:"featured_by_gitroom"`
	AI                   bool   `json:"ai"`
	ImportFromChannels   bool   `json:"import_from_channels"`
	ImageGenerator       bool   `json:"image_generator"`
	ImageGenerationCount int    `json:"image_generation_count"`
	GenerateVideos       int    `json:"generate_videos"`
	ClippingMinutes      int    `json:"clipping_minutes"`
	PublicAPI            bool   `json:"public_api"`
	Webhooks             int    `json:"webhooks"`
	AutoPost             bool   `json:"autoPost"`
}

// Pricing is the plan table, keyed by tier (FREE, STANDARD, TEAM, PRO,
// ULTIMATE).
var Pricing = map[string]PricingInner{
	"FREE": {
		Current: "FREE", MonthPrice: 0, YearPrice: 0, Channel: 0, ImageGenerationCount: 0, PostsPerMonth: 0,
		TeamMembers: false, CommunityFeatures: false, FeaturedByGitroom: false, AI: false,
		ImportFromChannels: false, ImageGenerator: false, PublicAPI: false, Webhooks: 0, AutoPost: false,
		GenerateVideos: 0, ClippingMinutes: 0,
	},
	"STANDARD": {
		Current: "STANDARD", MonthPrice: 29, YearPrice: 278, Channel: 5, PostsPerMonth: 1000000,
		ImageGenerationCount: 20, TeamMembers: false, AI: true, CommunityFeatures: false,
		FeaturedByGitroom: false, ImportFromChannels: true, ImageGenerator: false, PublicAPI: true,
		Webhooks: 2, AutoPost: false, GenerateVideos: 3, ClippingMinutes: 60,
	},
	"TEAM": {
		Current: "TEAM", MonthPrice: 39, YearPrice: 374, Channel: 10, PostsPerMonth: 1000000,
		ImageGenerationCount: 100, CommunityFeatures: true, TeamMembers: true, FeaturedByGitroom: true,
		AI: true, ImportFromChannels: true, ImageGenerator: true, PublicAPI: true, Webhooks: 10,
		AutoPost: true, GenerateVideos: 10, ClippingMinutes: 120,
	},
	"PRO": {
		Current: "PRO", MonthPrice: 49, YearPrice: 470, Channel: 30, PostsPerMonth: 1000000,
		ImageGenerationCount: 300, CommunityFeatures: true, TeamMembers: true, FeaturedByGitroom: true,
		AI: true, ImportFromChannels: true, ImageGenerator: true, PublicAPI: true, Webhooks: 30,
		AutoPost: true, GenerateVideos: 30, ClippingMinutes: 300,
	},
	"ULTIMATE": {
		Current: "ULTIMATE", MonthPrice: 99, YearPrice: 950, Channel: 100, PostsPerMonth: 1000000,
		ImageGenerationCount: 500, CommunityFeatures: true, TeamMembers: true, FeaturedByGitroom: true,
		AI: true, ImportFromChannels: true, ImageGenerator: true, PublicAPI: true, Webhooks: 10000,
		AutoPost: true, GenerateVideos: 60, ClippingMinutes: 600,
	},
}

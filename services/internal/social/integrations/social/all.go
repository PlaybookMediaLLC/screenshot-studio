// Package social registers every social provider in
// a fixed order. Order matters: it is
// the order of the add-channel screen and of the Temporal provider queues.
package social

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/bluesky"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/devto"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/discord"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/dribbble"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/facebook"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/farcaster"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/gmb"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/hashnode"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/instagram"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/instagramstandalone"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/kick"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/lemmy"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/linkedin"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/linkedinpage"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/listmonk"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/mastodon"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/medium"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/mewe"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/moltbook"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/nostr"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/pinterest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/reddit"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/skool"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/slack"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/telegram"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/threads"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/tiktok"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/tiktokbusiness"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/tumblr"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/twitch"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/vk"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/whop"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/wordpress"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/x"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/youtube"
)

// All returns a new instance of every registered provider. mastodoncustom is
// ported but, as in Postiz, not registered.
func All() []integrations.Provider {
	providers := []integrations.Provider{
		x.New(),
		linkedin.New(),
		linkedinpage.New(),
		reddit.New(),
		instagram.New(),
		instagramstandalone.New(),
		facebook.New(),
		threads.New(),
		youtube.New(),
		gmb.New(),
		tiktok.New(),
		tiktokbusiness.New(),
		pinterest.New(),
		dribbble.New(),
		discord.New(),
		slack.New(),
		kick.New(),
		twitch.New(),
		mastodon.New(),
		bluesky.New(),
		lemmy.New(),
		farcaster.New(),
		telegram.New(),
		nostr.New(),
		vk.New(),
		medium.New(),
		devto.New(),
		hashnode.New(),
		wordpress.New(),
		listmonk.New(),
		moltbook.New(),
		whop.New(),
		skool.New(),
		mewe.New(),
		tumblr.New(),
	}
	return append(providers, e2eProviders()...)
}

// NewManager is the IntegrationManager over All().
func NewManager() *integrations.Manager { return integrations.NewManager(All()) }

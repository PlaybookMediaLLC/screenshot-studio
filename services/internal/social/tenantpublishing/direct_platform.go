package tenantpublishing

func directPlatformAllowed(platform string) bool {
	switch platform {
	case "linkedin", "x", "instagram-standalone", "threads", "bluesky", "mastodon":
		return true
	}
	return e2ePlatformAllowed(platform)
}

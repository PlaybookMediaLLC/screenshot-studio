package tenantpublishing

func directPlatformAllowed(platform string) bool {
	switch platform {
	case "linkedin", "x", "instagram-standalone", "threads", "bluesky", "mastodon", "mastodon-custom":
		return true
	}
	return e2ePlatformAllowed(platform)
}

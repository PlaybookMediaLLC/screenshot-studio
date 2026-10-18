package tenantpublishing

func directPlatformAllowed(platform string) bool {
	return platform == "linkedin" || platform == "x" || platform == "instagram-standalone" || e2ePlatformAllowed(platform)
}

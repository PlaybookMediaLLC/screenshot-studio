//go:build e2e

package tenantpublishing

func e2ePlatformAllowed(platform string) bool { return platform == "e2e" }

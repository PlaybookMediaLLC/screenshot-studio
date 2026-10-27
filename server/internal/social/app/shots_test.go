package app

import "testing"

func TestShotsAssetDownloadsUseTheProductAPISettings(t *testing.T) {
	for _, key := range []string{"PUBLISHING_SERVICE_TOKEN", "BETTER_AUTH_URL"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, "standalone-fixture")
			t.Setenv("TENANT_"+key, "combined-fixture")
			if shotsPlatformEnv(key) != "combined-fixture" {
				t.Fatal("combined MCP signer does not use the product API setting")
			}
			t.Setenv("TENANT_"+key, "")
			if shotsPlatformEnv(key) != "standalone-fixture" {
				t.Fatal("standalone MCP setting is unavailable")
			}
			t.Setenv(key, "")
			if shotsPlatformEnv(key) != "" {
				t.Fatal("missing configuration did not fail closed")
			}
		})
	}
}

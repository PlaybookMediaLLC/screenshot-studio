package publishing

import "testing"

func TestOAuthCreationRequiresAnUnambiguousTarget(t *testing.T) {
	set, account := "set", "account"
	for _, test := range []struct {
		name    string
		options OAuthStartOptions
		valid   bool
	}{
		{"legacy add", OAuthStartOptions{}, true},
		{"legacy reconnect", OAuthStartOptions{SocialSetID: &set, ExpectedConnectionID: &account}, true},
		{"private creation", OAuthStartOptions{Operation: "CREATE_SET", CreationVisibility: "PRIVATE"}, true},
		{"team creation", OAuthStartOptions{Operation: "CREATE_SET", CreationVisibility: "WORKSPACE"}, true},
		{"missing owner", OAuthStartOptions{Operation: "CREATE_SET"}, false},
		{"unknown owner", OAuthStartOptions{Operation: "CREATE_SET", CreationVisibility: "OTHER"}, false},
		{"existing target", OAuthStartOptions{Operation: "CREATE_SET", CreationVisibility: "PRIVATE", SocialSetID: &set}, false},
		{"reconnect target", OAuthStartOptions{Operation: "CREATE_SET", CreationVisibility: "PRIVATE", ExpectedConnectionID: &account}, false},
		{"owner without creation", OAuthStartOptions{CreationVisibility: "PRIVATE"}, false},
		{"reconnect without account", OAuthStartOptions{Operation: "RECONNECT", SocialSetID: &set}, false},
		{"add with reconnect", OAuthStartOptions{Operation: "ADD_ACCOUNT", ExpectedConnectionID: &account}, false},
		{"unknown operation", OAuthStartOptions{Operation: "REPLACE"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateOAuthStartOptions(test.options); (err == nil) != test.valid {
				t.Fatalf("valid=%v error=%v", test.valid, err)
			}
		})
	}
}

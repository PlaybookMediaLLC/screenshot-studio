package newsletter

import "testing"

func TestGetProvider(t *testing.T) {
	t.Setenv("BEEHIIVE_API_KEY", "")
	t.Setenv("LISTMONK_API_KEY", "")
	if GetProvider().Name() != "empty" {
		t.Error("empty")
	}
	t.Setenv("LISTMONK_API_KEY", "k")
	if GetProvider().Name() != "listmonk" {
		t.Error("listmonk")
	}
	t.Setenv("BEEHIIVE_API_KEY", "k")
	if GetProvider().Name() != "beehiiv" {
		t.Error("beehiiv wins")
	}
}

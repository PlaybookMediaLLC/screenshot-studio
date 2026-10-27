package draftdoc

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCommunityBroadcastRoundTrip(t *testing.T) {
	for _, choice := range []string{"", `,"shareWithFollowers":false`, `,"shareWithFollowers":true`} {
		raw := `{"id":"42"` + choice + `}`
		var community Community
		if err := json.Unmarshal([]byte(raw), &community); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(community)
		if err != nil {
			t.Fatal(err)
		}
		if string(encoded) != raw {
			t.Fatalf("choice lost: %s -> %s", raw, encoded)
		}
		if choice == "" && strings.Contains(string(encoded), "shareWithFollowers") {
			t.Fatal("legacy default became an explicit choice")
		}
	}
}

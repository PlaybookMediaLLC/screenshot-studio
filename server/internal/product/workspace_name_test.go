package product

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func TestWorkspaceNameSharedPolicy(t *testing.T) {
	data, err := os.ReadFile("../../../clients/apps/web/test/workspace-name-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Label      string
		Input      string
		Normalized *string
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		t.Run(item.Label, func(t *testing.T) {
			value, err := NormalizeWorkspaceName(item.Input)
			if item.Normalized == nil {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("accepted invalid name: %q", value)
				}
			} else if err != nil || value != *item.Normalized {
				t.Fatalf("normalized=%q err=%v", value, err)
			}
		})
	}
}

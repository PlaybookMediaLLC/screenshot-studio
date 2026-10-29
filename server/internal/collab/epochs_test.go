package collab

import (
	"context"
	"testing"
)

func TestMemoryEpochsCountPerWorkspaceAndGlobally(t *testing.T) {
	ctx := context.Background()
	epochs := NewMemoryEpochs()
	for _, organization := range []string{"a", "a", "", "b"} {
		if err := epochs.Bump(ctx, organization); err != nil {
			t.Fatal(err)
		}
	}
	global, counts, err := epochs.Read(ctx, []string{"a", "b", "c"})
	if err != nil {
		t.Fatal(err)
	}
	if global != 1 || counts["a"] != 2 || counts["b"] != 1 || counts["c"] != 0 {
		t.Fatalf("global=%d counts=%v", global, counts)
	}
}

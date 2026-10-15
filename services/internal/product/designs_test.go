package product

import (
	"errors"
	"testing"
)

func TestDesignAssetIDsChecksAllRenderableSources(t *testing.T) {
	assetA := "e8197cef-d184-48e5-8a17-6db0eabcf015"
	assetB := "b84e4e1c-c4ab-43bb-8cd4-e75237300fa7"
	document := map[string]any{
		"version":    float64(1),
		"image":      map[string]any{"src": "asset:" + assetA},
		"background": map[string]any{"type": "image", "value": "/images/backdrop.png"},
		"devices":    map[string]any{"mockups": []any{map[string]any{"screen": map[string]any{"src": "asset:" + assetB}}}},
		"overlays":   []any{map[string]any{"src": "asset:" + assetA}},
	}
	ids, err := designAssetIDs(document)
	if err != nil || len(ids) != 2 {
		t.Fatalf("design assets=%v err=%v", ids, err)
	}
	document["overlays"] = []any{map[string]any{"src": "https://other.example/image.png"}}
	if _, err := designAssetIDs(document); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("external overlay accepted: %v", err)
	}
}

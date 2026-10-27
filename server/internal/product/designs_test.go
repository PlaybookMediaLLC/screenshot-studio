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

func TestDesignAssetIDsReadsVersionTwoSections(t *testing.T) {
	asset := "e8197cef-d184-48e5-8a17-6db0eabcf015"
	slide := "b84e4e1c-c4ab-43bb-8cd4-e75237300fa7"
	document := map[string]any{
		"version":    float64(2),
		"image":      map[string]any{"src": nil},
		"background": map[string]any{"type": "image", "value": "backgrounds/raycast/red_distortion_4.webp"},
		"slides":     map[string]any{"items": []any{map[string]any{"src": "asset:" + slide}}},
		"texts":      []any{map[string]any{"text": "asset: not a reference", "fontFamily": "asset:" + asset}},
	}
	ids, err := designAssetIDs(document)
	if err != nil || len(ids) != 2 {
		t.Fatalf("design assets=%v err=%v", ids, err)
	}
	document["slides"] = map[string]any{"items": []any{map[string]any{"src": "blob:http://localhost/x"}}}
	if _, err := designAssetIDs(document); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("local slide accepted: %v", err)
	}
	document["slides"] = nil
	document["version"] = float64(3)
	if _, err := designAssetIDs(document); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown version accepted: %v", err)
	}
}

func TestDesignAssetIDsChecksTimelineAudio(t *testing.T) {
	music := "5f2b8c1e-3a4d-4e6f-9a0b-1c2d3e4f5a6b"
	document := map[string]any{
		"version": float64(2),
		"image":   map[string]any{"src": nil},
		"timeline": map[string]any{
			"duration": float64(4000),
			"audio":    []any{map[string]any{"src": "asset:" + music, "start": float64(0)}},
		},
	}
	ids, err := designAssetIDs(document)
	if err != nil || len(ids) != 1 || ids[0] != music {
		t.Fatalf("timeline audio assets=%v err=%v", ids, err)
	}
	document["timeline"].(map[string]any)["audio"] = []any{map[string]any{"src": "blob:http://localhost/music"}}
	if _, err := designAssetIDs(document); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("local audio accepted: %v", err)
	}
}

package product

import (
	"errors"
	"strings"
	"testing"
)

// The editor block of a kit definition is kept as sent, capped in size, and
// its workspace assets are found so the backend can check them.
func TestBrandKitEditorBlock(t *testing.T) {
	logo := "asset:1b4e28ba-2fa1-11d2-883f-0016d3cca427"
	background := "asset:2c4e28ba-2fa1-11d2-883f-0016d3cca427"
	definition := map[string]any{
		"colors":     map[string]any{"text": "#111111", "background": "#ffffff", "accent": "#6d5dfc"},
		"typography": map[string]any{"headingFamily": "inter"},
		"editor": map[string]any{
			"logos":      []any{map[string]any{"id": "l1", "name": "Light", "src": logo, "tone": "light"}},
			"background": map[string]any{"type": "image", "value": background},
			"palette":    []any{"#ff0000"},
		},
	}
	canonical, _, err := normalizeBrandKitDefinition(definition)
	if err != nil {
		t.Fatal(err)
	}
	editor, _ := canonical["editor"].(map[string]any)
	if editor == nil || editor["palette"] == nil {
		t.Fatalf("editor block dropped: %+v", canonical)
	}
	assets, err := brandKitEditorAssets(canonical)
	if err != nil || len(assets) != 2 {
		t.Fatalf("assets=%v err=%v", assets, err)
	}

	local := map[string]any{"colors": definition["colors"], "typography": definition["typography"],
		"editor": map[string]any{"logos": []any{map[string]any{"src": "blob:http://localhost/x"}}}}
	if canonical, _, err := normalizeBrandKitDefinition(local); err != nil {
		t.Fatal(err)
	} else if _, err := brandKitEditorAssets(canonical); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("local image accepted: %v", err)
	}

	huge := map[string]any{"colors": definition["colors"], "typography": definition["typography"],
		"editor": map[string]any{"palette": strings.Repeat("x", 40<<10)}}
	if _, _, err := normalizeBrandKitDefinition(huge); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized editor block accepted: %v", err)
	}
	if _, _, err := normalizeBrandKitDefinition(map[string]any{"colors": definition["colors"],
		"typography": definition["typography"], "editor": "nope"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("non-object editor accepted: %v", err)
	}
}

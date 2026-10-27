package product

import (
	"errors"
	"testing"
)

func TestNormalizeBrandKitDefinition(t *testing.T) {
	colors := map[string]any{"text": "#111111", "background": "#FFFFFF", "accent": "#3366ff"}
	fonts := map[string]any{"headingFamily": "inter"}
	cases := map[string]struct {
		definition map[string]any
		valid      bool
	}{
		"current":           {map[string]any{"schemaVersion": float64(1), "colors": colors, "typography": fonts}, true},
		"legacy foreground": {map[string]any{"colors": map[string]any{"foreground": "#111111", "background": "#ffffff", "accent": "#000000"}, "typography": fonts}, true},
		"logo":              {map[string]any{"colors": colors, "typography": fonts, "logo": map[string]any{"primaryAssetId": "6f1c2a8e-3d4b-4c5a-9e7f-1a2b3c4d5e6f"}}, true},
		"short hex":         {map[string]any{"colors": map[string]any{"text": "#111", "background": "#ffffff", "accent": "#000000"}, "typography": fonts}, false},
		"missing accent":    {map[string]any{"colors": map[string]any{"text": "#111111", "background": "#ffffff"}, "typography": fonts}, false},
		"long font":         {map[string]any{"colors": colors, "typography": map[string]any{"headingFamily": string(make([]byte, 65))}}, false},
		"empty body font":   {map[string]any{"colors": colors, "typography": map[string]any{"headingFamily": "inter", "bodyFamily": ""}}, false},
		"bad logo":          {map[string]any{"colors": colors, "typography": fonts, "logo": map[string]any{"primaryAssetId": "logo.png"}}, false},
		"version two":       {map[string]any{"schemaVersion": float64(2), "colors": colors, "typography": fonts}, false},
	}
	for name, tc := range cases {
		canonical, _, err := normalizeBrandKitDefinition(tc.definition)
		if (err == nil) != tc.valid || (err != nil && !errors.Is(err, ErrInvalidInput)) {
			t.Errorf("%s: err=%v, want valid=%v", name, err, tc.valid)
		}
		if err == nil && (canonical["schemaVersion"] != 1 || canonical["colors"].(map[string]any)["text"] != "#111111") {
			t.Errorf("%s: canonical=%v", name, canonical)
		}
	}
}

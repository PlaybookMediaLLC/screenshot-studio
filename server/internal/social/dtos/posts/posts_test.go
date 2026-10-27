package posts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMediaKeepsClientProperties(t *testing.T) {
	var p PostContent
	if err := json.Unmarshal([]byte(`{"content":"x","image":[{"id":"m1","path":"https://cdn.example.com/a.mp4","thumbnailTimestamp":1500}]}`), &p); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(p.Image)
	if !strings.Contains(string(out), `"thumbnailTimestamp":1500`) || p.Image[0].Path != "https://cdn.example.com/a.mp4" {
		t.Fatalf("image = %s", out)
	}

	var bad MediaDto
	_ = json.Unmarshal([]byte(`{"path":"https://cdn.example.com/a.txt"}`), &bad)
	got := strings.Join(bad.validate("posts.0.value.0.image.0."), "|")
	want := "posts.0.value.0.image.0.id should not be null or undefined|posts.0.value.0.image.0.id must be a string|" +
		"posts.0.value.0.image.0.File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4"
	if got != want {
		t.Fatalf("messages = %q", got)
	}
}

func TestIsISODate(t *testing.T) {
	for value, want := range map[string]bool{
		"2025-03-03": true, "2025-03-03T10:00:00": true, "2025-03-03T10:00:00.000Z": true,
		"2025-03-03T10:00:00+02:00": true, "nope": false, "2025-13-01": false, "": false,
	} {
		if IsISODate(value) != want {
			t.Errorf("IsISODate(%q) = %v", value, !want)
		}
	}
}

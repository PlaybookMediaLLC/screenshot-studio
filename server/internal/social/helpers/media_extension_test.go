package helpers

import "testing"

func TestMediaExtensionIgnoresSignedQueryAndDirectoryNames(t *testing.T) {
	for _, tc := range []struct {
		location, extension string
		want                bool
	}{
		{"https://cdn.example/image.PNG?signature=fixture.pdf", "png", true},
		{"https://cdn.example/image.png?signature=fixture.pdf", "pdf", false},
		{"https://cdn.example/.mp4/image.png", "mp4", false},
		{"https://cdn.example/document.pdf.png", "pdf", false},
		{"https://cdn.example/document.PDF?signature=fixture.png", ".pdf", true},
		{"https://cdn.example/video%2Emp4?signature=fixture", "mp4", true},
		{"/tmp/staged-video.mp4", "mp4", true},
		{"", "png", false},
	} {
		t.Run(tc.location+"/"+tc.extension, func(t *testing.T) {
			if got := HasExtension(tc.location, tc.extension); got != tc.want {
				t.Fatalf("HasExtension(%q, %q) = %v, want %v", tc.location, tc.extension, got, tc.want)
			}
		})
	}
}

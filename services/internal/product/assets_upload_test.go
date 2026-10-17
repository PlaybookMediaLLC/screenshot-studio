package product

import "testing"

func TestValidAssetUploadAcceptsTimelineAudio(t *testing.T) {
	upload := AssetUploadInput{Bytes: 1024, Classification: "input", FileName: "music.mp3"}
	for _, contentType := range []string{"audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"} {
		upload.ContentType = contentType
		if !validAssetUpload(upload) {
			t.Fatalf("%s refused", contentType)
		}
	}
	for _, contentType := range []string{"audio/x-unknown", "application/octet-stream", "text/html"} {
		upload.ContentType = contentType
		if validAssetUpload(upload) {
			t.Fatalf("%s accepted", contentType)
		}
	}
}

package product

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestVerifyAssetBytes(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	png := encoded.Bytes()
	if err := verifyAssetBytes("image/png", bytes.NewReader(png)); err != nil {
		t.Fatalf("a PNG: %v", err)
	}
	if err := verifyAssetBytes("image/png", strings.NewReader("<html>not an image</html>")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("HTML passed as a PNG: %v", err)
	}
	if err := verifyAssetBytes("application/pdf", bytes.NewReader(png)); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("a PNG passed as a PDF: %v", err)
	}
	if err := verifyAssetBytes("font/woff2", strings.NewReader("anything")); err != nil {
		t.Fatalf("unchecked types pass: %v", err)
	}
}

func pdfWithPages(count int, _ bool) string {
	var builder strings.Builder
	builder.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	object := func(id int, body string) {
		offsets = append(offsets, builder.Len())
		fmt.Fprintf(&builder, "%d 0 obj\n%s\nendobj\n", id, body)
	}
	object(1, "<< /Type /Catalog /Pages 2 0 R >>")
	kids := ""
	for i := 0; i < count; i++ {
		kids += fmt.Sprintf("%d 0 R ", i+3)
	}
	object(2, fmt.Sprintf("<< /Type /Pages /Count %d /Kids [%s] >>", count, kids))
	for i := 0; i < count; i++ {
		object(i+3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>")
	}
	xref := builder.Len()
	fmt.Fprintf(&builder, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&builder, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&builder, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return builder.String()
}

func TestPDFPageLimit(t *testing.T) {
	if pages, known := countPDFPages(strings.NewReader(pdfWithPages(12, true))); !known || pages != 12 {
		t.Fatalf("root count: %d %v", pages, known)
	}
	if pages, known := countPDFPages(strings.NewReader(pdfWithPages(7, false))); !known || pages != 7 {
		t.Fatalf("page objects: %d %v", pages, known)
	}
	if _, known := countPDFPages(strings.NewReader("%PDF-1.7\n<< /ObjStm compressed >>")); known {
		t.Fatal("a compressed page tree read as known")
	}
	if err := verifyAssetBytes("application/pdf", strings.NewReader(pdfWithPages(301, true))); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("301 pages accepted: %v", err)
	}
	if err := verifyAssetBytes("application/pdf", strings.NewReader(pdfWithPages(300, false))); err != nil {
		t.Fatalf("300 pages refused: %v", err)
	}
}

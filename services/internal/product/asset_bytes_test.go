package product

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestVerifyAssetBytes(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
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

func pdfWithPages(count int, root bool) string {
	var builder strings.Builder
	builder.WriteString("%PDF-1.4\n")
	if root {
		fmt.Fprintf(&builder, "1 0 obj << /Type /Pages /Kids [] /Count %d >> endobj\n", count)
	}
	for index := range count {
		fmt.Fprintf(&builder, "%d 0 obj << /Type /Page /Parent 1 0 R >> endobj\n", index+2)
	}
	builder.WriteString("%%EOF\n")
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

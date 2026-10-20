package product

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Upload checks (RFC 042): an upload's bytes must be what it says it is,
// checked from storage when it completes, so a renamed file cannot pass as
// an image or a PDF. A PDF is also held to LinkedIn's document limits.

const (
	pdfByteLimit = 100 << 20
	pdfPageLimit = 300
)

// objectOpener streams a stored object, to check an upload's bytes.
type objectOpener interface {
	Open(ctx context.Context, key string) (io.ReadCloser, error)
}

// sniffedTypes are the media types whose first bytes are checked, and what
// net/http's sniffer reports for each.
var sniffedTypes = map[string]string{
	"image/gif": "image/gif", "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp",
	"video/mp4": "video/mp4", "video/webm": "video/webm",
}

// verifyAssetBytes checks an object's bytes against its declared type.
func verifyAssetBytes(mediaType string, object io.Reader) error {
	reader := bufio.NewReaderSize(object, 4096)
	head, _ := reader.Peek(512)
	if mediaType == "application/pdf" {
		if !bytes.HasPrefix(head, []byte("%PDF-")) {
			return invalid("This file is not a PDF.")
		}
		pages, known := countPDFPages(io.LimitReader(reader, pdfByteLimit+1))
		if known && pages > pdfPageLimit {
			return invalid("LinkedIn takes documents of up to 300 pages; this one has " + strconv.Itoa(pages) + ".")
		}
		return nil
	}
	want, checked := sniffedTypes[mediaType]
	if !checked {
		return nil
	}
	got := http.DetectContentType(head)
	if !strings.HasPrefix(got, want) {
		return invalid("This file's contents are not a " + mediaType + " file.")
	}
	return nil
}

var (
	pdfPageObject = regexp.MustCompile(`/Type\s*/Page[^s]`)
	pdfPageCount  = regexp.MustCompile(`/Type\s*/Pages[^>]*?/Count\s+(\d+)|/Count\s+(\d+)[^>]*?/Type\s*/Pages`)
)

// countPDFPages counts a PDF's pages from its page tree when the tree is
// stored plainly: the root's /Count, or else the page objects themselves.
//
// ponytail: a PDF whose page tree sits in compressed object streams reads as
// unknown, and LinkedIn's own processing then enforces its 300 pages (the
// post fails visibly). Parse object streams if that proves common.
func countPDFPages(object io.Reader) (int, bool) {
	scanner := bufio.NewScanner(object)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	scanner.Split(splitWithOverlap)
	objects, rootCount := 0, 0
	for scanner.Scan() {
		chunk := scanner.Bytes()
		objects += len(pdfPageObject.FindAll(chunk, -1))
		for _, match := range pdfPageCount.FindAllSubmatch(chunk, -1) {
			for _, group := range match[1:] {
				if count, err := strconv.Atoi(string(group)); err == nil && count > rootCount {
					rootCount = count
				}
			}
		}
	}
	switch {
	case rootCount > 0:
		return rootCount, true
	case objects > 0:
		return objects, true
	}
	return 0, false
}

// splitWithOverlap hands the scanner chunks of up to 64 KB that end at a
// line break or after a full buffer, so a marker split across reads is seen
// whole in at least one chunk.
func splitWithOverlap(data []byte, atEOF bool) (int, []byte, error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if index := bytes.LastIndexByte(data, '\n'); index >= 0 && (index > 32<<10 || atEOF) {
		return index + 1, data[:index+1], nil
	}
	if len(data) >= 64<<10 || atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

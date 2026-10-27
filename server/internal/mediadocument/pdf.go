// Package mediadocument validates native document assets at ingestion and publication.
package mediadocument

import (
	"bytes"
	"io"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/medialimits"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// CountPages validates the catalog and page tree, including compressed object
// streams. Unknown and encrypted documents are rejected rather than made ready.
func CountPages(object io.Reader) (count int, known bool) {
	defer func() {
		if recover() != nil {
			count, known = 0, false
		}
	}()
	data, err := io.ReadAll(io.LimitReader(object, int64(medialimits.Limits.PDFBytes)+1))
	if err != nil || len(data) > medialimits.Limits.PDFBytes {
		return 0, false
	}
	conf := model.NewDefaultConfiguration()
	count, err = api.PageCount(bytes.NewReader(data), conf)
	return count, err == nil && count > 0
}

package upload

import (
	"context"
	"errors"
	"io"
	"net/http"
	"regexp"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// This file is multer.stream.engine.ts plus FileInterceptor('file',
// streamUploadOptions()): each incoming file streams straight into storage
// instead of being buffered whole in memory. Filename / Path end up as the
// stored key and public URL, Originalname keeps the sender's name with the
// detected extension.

// MulterFile is the Express.Multer.File the controllers read.
type MulterFile struct {
	Filename     string `json:"filename"`
	Path         string `json:"path"`
	Mimetype     string `json:"mimetype"`
	Originalname string `json:"originalname"`
}

var (
	trailingExt = regexp.MustCompile(`\.[^./\\]*$`)
	slashes     = regexp.MustCompile(`[\\/]`)
)

// safeOriginalName strips the sender's extension and path separators, keeps
// 100 UTF-16 units and adds the detected extension.
func safeOriginalName(originalname, ext string) string {
	if originalname == "" {
		originalname = "upload"
	}
	base := slashes.ReplaceAllString(trailingExt.ReplaceAllString(originalname, ""), "_")
	if units := utf16.Encode([]rune(base)); len(units) > 100 {
		base = string(utf16.Decode(units[:100]))
	}
	if base == "" {
		base = "upload"
	}
	return base + "." + ext
}

// ReceiveFile reads a multipart request the way FileInterceptor(field) with
// the stream engine does. It returns the stored file (nil when the request
// has none, or is not multipart) and the text fields (req.body). A file
// under any other field name, or a second one, is multer's 400 "Unexpected
// field"; a file stored before the request fails is removed again.
func ReceiveFile(ctx context.Context, storage Provider, r *http.Request, field string) (*MulterFile, map[string]string, error) {
	fields := map[string]string{}
	reader, err := r.MultipartReader()
	if errors.Is(err, http.ErrNotMultipart) {
		return nil, fields, nil
	}
	if err != nil {
		return nil, fields, httpx.BadRequest(err.Error())
	}

	var file *MulterFile
	fail := func(err error) (*MulterFile, map[string]string, error) {
		// _removeFile: multer drops a file it already stored when the
		// request fails afterwards
		if file != nil {
			_ = storage.RemoveFile(ctx, file.Path)
		}
		return nil, fields, err
	}

	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return file, fields, nil
		}
		if err != nil {
			return fail(httpx.BadRequest(err.Error()))
		}

		if part.FileName() == "" {
			value, err := io.ReadAll(part)
			if err != nil {
				return fail(httpx.BadRequest(err.Error()))
			}
			fields[part.FormName()] = string(value)
			continue
		}

		if part.FormName() != field || file != nil {
			return fail(httpx.BadRequest("Unexpected field"))
		}

		uploaded, err := UploadStreamToStorage(ctx, storage, part, 0)
		if err != nil {
			return fail(err)
		}
		file = &MulterFile{
			Filename:     uploaded.Filename,
			Path:         uploaded.Path,
			Mimetype:     uploaded.Mimetype,
			Originalname: safeOriginalName(part.FileName(), uploaded.Ext),
		}
	}
}

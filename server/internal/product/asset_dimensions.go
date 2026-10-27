package product

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"io"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

// Decode only the header, with bounded work even for malformed image uploads.
func decodeAssetDimensions(reader io.Reader) (*image.Config, error) {
	dimensions, _, err := image.DecodeConfig(io.LimitReader(reader, 2<<20))
	if err != nil || dimensions.Width < 1 || dimensions.Height < 1 || int64(dimensions.Width)*int64(dimensions.Height) > 64_000_000 {
		return nil, invalid("The image dimensions are invalid or exceed 64 megapixels.")
	}
	return &dimensions, nil
}

func (c *Configuration) uploadedImageDimensions(ctx context.Context, row *ent.Asset) (*image.Config, error) {
	if !strings.HasPrefix(row.MediaType, "image/") {
		return nil, nil
	}
	if opener, ok := c.objects.(objectOpener); ok {
		object, err := opener.Open(ctx, row.ObjectKey)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
		}
		defer object.Close()
		return decodeAssetDimensions(object)
	}
	body, err := c.objects.Read(ctx, row.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	return decodeAssetDimensions(bytes.NewReader(body))
}

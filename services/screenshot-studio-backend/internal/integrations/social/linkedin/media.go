package linkedin

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"path"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"golang.org/x/image/draw"
)

// jpegQuality is sharp's default JPEG quality.
const jpegQuality = 80

// mimeLookup is mime-types lookup() for the types prepareMediaBuffer branches on.
func mimeLookup(p string) string {
	switch strings.ToLower(path.Ext(p)) {
	case ".gif":
		return "image/gif"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg", ".jpe":
		return "image/jpeg"
	}
	return ""
}

// prepareMediaBuffer reads an image and re-encodes it like the sharp pipeline:
// GIFs pass through untouched (re-encoding would break animation), PNG and
// JPEG keep their format, anything else becomes JPEG.
func (p *Provider) prepareMediaBuffer(ctx context.Context, mediaURL string) ([]byte, error) {
	raw, err := p.ReadOrFetch(ctx, mediaURL)
	if err != nil {
		return nil, err
	}
	mime := mimeLookup(mediaURL)
	if mime == "image/gif" {
		return raw, nil
	}
	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	// Always downscale to stay under LinkedIn's 36,152,320-pixel cap: fit
	// within a 6000x6000 box (max 36,000,000 px for any aspect ratio), never
	// enlarging. Required for self-hosted DISABLE_IMAGE_COMPRESSION=true
	// instances, where full-size images reach LinkedIn directly.
	img = fitInside(img, 6000, 6000)

	var out bytes.Buffer
	keepFormat := mime == "image/png" || mime == "image/jpeg"
	if keepFormat && format == "png" {
		err = png.Encode(&out, img)
	} else {
		err = jpeg.Encode(&out, img, &jpeg.Options{Quality: jpegQuality})
	}
	return out.Bytes(), err
}

// fitInside is sharp's resize({fit: 'inside', withoutEnlargement: true}).
func fitInside(img image.Image, maxW, maxH int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxW && h <= maxH {
		return img
	}
	scale := min(float64(maxW)/float64(w), float64(maxH)/float64(h))
	dst := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(w)*scale+0.5)), max(1, int(float64(h)*scale+0.5))))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst
}

type pdfImage struct {
	jpeg          []byte
	width, height int
	gray          bool
}

// convertImagesToPDFCarousel converts every image to JPEG and lays them out
// as a PDF sized to the largest image (by area): it fills the page, smaller
// images are fitted and centered within the same dimensions.
func (p *Provider) convertImagesToPDFCarousel(ctx context.Context, media []integrations.MediaContent) ([]byte, error) {
	pages := make([]pdfImage, 0, len(media))
	for _, m := range media {
		raw, err := p.ReadOrFetch(ctx, m.Path)
		if err != nil {
			return nil, err
		}
		img, _, err := image.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		var out bytes.Buffer
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return nil, err
		}
		_, gray := img.(*image.Gray) // encoded with a single component
		pages = append(pages, pdfImage{jpeg: out.Bytes(), width: img.Bounds().Dx(), height: img.Bounds().Dy(), gray: gray})
	}
	largest := pages[0]
	for _, pg := range pages[1:] {
		if pg.width*pg.height > largest.width*largest.height {
			largest = pg
		}
	}
	return buildPDF(pages, float64(largest.width), float64(largest.height)), nil
}

// buildPDF is image-to-pdf (pdfkit): one page of the given size per JPEG,
// each image fitted and centered (fit: size, align/valign: center).
func buildPDF(pages []pdfImage, width, height float64) []byte {
	var buf bytes.Buffer
	n := 2 + 3*len(pages)
	offsets := make([]int, n+1)
	write := func(id int, dict string, stream []byte) {
		offsets[id] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\n", id, dict)
		if stream != nil {
			buf.WriteString("stream\n")
			buf.Write(stream)
			buf.WriteString("\nendstream\n")
		}
		buf.WriteString("endobj\n")
	}

	buf.WriteString("%PDF-1.3\n%\xff\xff\xff\xff\n")
	write(1, "<< /Type /Catalog /Pages 2 0 R >>", nil)
	kids := make([]string, len(pages))
	for i := range pages {
		kids[i] = fmt.Sprintf("%d 0 R", 3+3*i)
	}
	write(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pages)), nil)

	for i, pg := range pages {
		pageID, contentID, imageID := 3+3*i, 4+3*i, 5+3*i
		w, h := float64(pg.width), float64(pg.height)
		scale := min(width/w, height/h)
		dw, dh := w*scale, h*scale
		content := fmt.Sprintf("q %.4f 0 0 %.4f %.4f %.4f cm /I0 Do Q", dw, dh, (width-dw)/2, (height-dh)/2)
		write(pageID, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] /Resources << /XObject << /I0 %d 0 R >> >> /Contents %d 0 R >>",
			width, height, imageID, contentID), nil)
		write(contentID, fmt.Sprintf("<< /Length %d >>", len(content)), []byte(content))
		colorSpace := "/DeviceRGB"
		if pg.gray {
			colorSpace = "/DeviceGray"
		}
		write(imageID, fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>",
			pg.width, pg.height, colorSpace, len(pg.jpeg)), pg.jpeg)
	}

	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", n+1)
	for id := 1; id <= n; id++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[id])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", n+1, xref)
	return buf.Bytes()
}

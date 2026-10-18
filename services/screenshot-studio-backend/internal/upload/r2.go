package upload

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
)

// This file holds the Uppy multipart endpoints behind
// POST /media/:endpoint, talking to R2 with region "auto".

var allowedExtToMime = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".tif":  "image/tiff",
	".tiff": "image/tiff",
	".mp4":  "video/mp4",
}

// multipartExtToMime: multipart uploads go through the normalizer, so they
// may also carry QuickTime, which it turns into an mp4; simple uploads never
// do.
func multipartExtToMime(ext string) string {
	if ext == ".mov" && ProcessorEnabled() {
		return "video/quicktime"
	}
	return allowedExtToMime[ext]
}

// extname is Node's path.extname.
func extname(p string) string {
	base := p[strings.LastIndex(p, "/")+1:]
	i := strings.LastIndex(base, ".")
	if i <= 0 {
		return ""
	}
	return base[i:]
}

func normalizeExtension(filename string) string {
	ext := strings.ToLower(extname(filename))
	if multipartExtToMime(ext) == "" {
		return ""
	}
	return ext
}

func r2() *s3.Client {
	return newR2Client(os.Getenv("CLOUDFLARE_ACCOUNT_ID"), os.Getenv("CLOUDFLARE_ACCESS_KEY"), os.Getenv("CLOUDFLARE_SECRET_ACCESS_KEY"), "auto")
}

func bucket() *string { return aws.String(os.Getenv("CLOUDFLARE_BUCKETNAME")) }

func generateRandomString() string { return ids.Make(20) }

// HandleR2Upload is handleR2Upload. Like the Express version it answers the
// request itself (c.JSON / c.Send), except a successful
// complete-multipart-upload, whose result is returned unsent so the
// controller can save the media and answer {...upload, saved}; c.Written()
// tells the two apart (res.headersSent).
func HandleR2Upload(ctx context.Context, c *httpx.Ctx, endpoint string) (map[string]any, error) {
	switch endpoint {
	case "create-multipart-upload":
		return nil, createMultipartUpload(ctx, c)
	case "prepare-upload-parts":
		return nil, prepareUploadParts(ctx, c)
	case "complete-multipart-upload":
		return completeMultipartUpload(ctx, c)
	case "list-parts":
		return nil, listParts(ctx, c)
	case "abort-multipart-upload":
		return nil, abortMultipartUpload(ctx, c)
	case "sign-part":
		return nil, signPart(ctx, c)
	}
	c.Send(http.StatusNotFound, nil)
	return nil, nil
}

// SimpleUpload is r2.uploader's simpleUpload.
func SimpleUpload(ctx context.Context, data []byte, originalFilename, contentType string) (string, error) {
	detected := DetectFileType(data)
	allowed := false
	if detected != nil {
		for _, mime := range allowedExtToMime {
			allowed = allowed || mime == detected.Mime
		}
	}
	if !allowed {
		return "", errors.New("Unsupported file type.")
	}
	randomFilename := generateRandomString() + "." + detected.Ext

	if _, err := r2().PutObject(ctx, &s3.PutObjectInput{
		Bucket:      bucket(),
		Key:         aws.String(randomFilename),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(detected.Mime),
	}); err != nil {
		return "", err
	}
	return os.Getenv("CLOUDFLARE_BUCKET_URL") + "/" + randomFilename, nil
}

// sdkError renders an SDK failure the way res.json(err) serializes an AWS
// SDK v3 ServiceException: its enumerable name, $fault and $metadata.
func sdkError(err error) map[string]any {
	body := map[string]any{"name": "Error"}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		body["name"] = apiErr.ErrorCode()
		body["$fault"] = map[smithy.ErrorFault]string{smithy.FaultServer: "server"}[apiErr.ErrorFault()]
		if body["$fault"] == "" {
			body["$fault"] = "client"
		}
	}
	var respErr *smithyhttp.ResponseError
	if errors.As(err, &respErr) {
		body["$metadata"] = map[string]any{"httpStatusCode": respErr.HTTPStatusCode()}
	}
	return body
}

func fail(c *httpx.Ctx, err error) error {
	slog.Info("Error", "error", err)
	c.JSON(http.StatusInternalServerError, sdkError(err))
	return nil
}

func createMultipartUpload(ctx context.Context, c *httpx.Ctx) error {
	var body struct {
		File *struct {
			Name string `json:"name"`
		} `json:"file"`
		FileHash *string `json:"fileHash"`
	}
	if err := c.Decode(&body); err != nil {
		return err
	}
	name := ""
	if body.File != nil {
		name = body.File.Name
	}
	safeExt := normalizeExtension(name)
	if safeExt == "" {
		c.JSON(http.StatusBadRequest, map[string]any{"message": "Unsupported file type."})
		return nil
	}
	safeContentType := multipartExtToMime(safeExt)
	randomFilename := generateRandomString() + safeExt

	in := &s3.CreateMultipartUploadInput{
		Bucket:      bucket(),
		Key:         aws.String(randomFilename),
		ContentType: aws.String(safeContentType),
	}
	if body.FileHash != nil {
		in.Metadata = map[string]string{"x-amz-meta-file-hash": *body.FileHash}
	}
	response, err := r2().CreateMultipartUpload(ctx, in)
	if err != nil {
		slog.Info("Error", "error", err)
		c.JSON(http.StatusInternalServerError, map[string]any{"source": map[string]any{"status": 500}})
		return nil
	}
	c.JSON(http.StatusOK, map[string]any{"uploadId": response.UploadId, "key": response.Key})
	return nil
}

// jsInt is parseInt over a JSON number or string.
func jsInt(v any) int32 {
	switch n := v.(type) {
	case float64:
		return int32(n)
	case string:
		digits := strings.TrimSpace(n)
		end := 0
		for end < len(digits) && (digits[end] >= '0' && digits[end] <= '9' || end == 0 && (digits[0] == '-' || digits[0] == '+')) {
			end++
		}
		i, _ := strconv.Atoi(digits[:end])
		return int32(i)
	}
	return 0
}

func prepareUploadParts(ctx context.Context, c *httpx.Ctx) error {
	var body struct {
		PartData struct {
			Key      string `json:"key"`
			UploadID string `json:"uploadId"`
			Parts    []struct {
				Number any `json:"number"`
			} `json:"parts"`
		} `json:"partData"`
	}
	if err := c.Decode(&body); err != nil {
		return err
	}

	presigner := s3.NewPresignClient(r2())
	presignedURLs := map[string]string{}
	for _, part := range body.PartData.Parts {
		req, err := presigner.PresignUploadPart(ctx, &s3.UploadPartInput{
			Bucket:     bucket(),
			Key:        aws.String(body.PartData.Key),
			PartNumber: aws.Int32(jsInt(part.Number)),
			UploadId:   aws.String(body.PartData.UploadID),
		}, s3.WithPresignExpires(time.Hour))
		if err != nil {
			return fail(c, err)
		}
		presignedURLs[strconv.Itoa(int(jsInt(part.Number)))] = req.URL
	}
	c.JSON(http.StatusOK, map[string]any{"presignedUrls": presignedURLs})
	return nil
}

type keyUpload struct {
	Key      string `json:"key"`
	UploadID string `json:"uploadId"`
}

func listParts(ctx context.Context, c *httpx.Ctx) error {
	var body keyUpload
	if err := c.Decode(&body); err != nil {
		return err
	}
	response, err := r2().ListParts(ctx, &s3.ListPartsInput{
		Bucket: bucket(), Key: aws.String(body.Key), UploadId: aws.String(body.UploadID),
	})
	if err != nil {
		return fail(c, err)
	}
	if response.Parts == nil {
		c.JSON(http.StatusOK, nil)
		return nil
	}
	parts := make([]map[string]any, 0, len(response.Parts))
	for _, p := range response.Parts {
		part := map[string]any{"PartNumber": p.PartNumber, "ETag": p.ETag, "Size": p.Size}
		if p.LastModified != nil {
			part["LastModified"] = p.LastModified.UTC().Format("2006-01-02T15:04:05.000Z")
		}
		parts = append(parts, part)
	}
	c.JSON(http.StatusOK, parts)
	return nil
}

func completeMultipartUpload(ctx context.Context, c *httpx.Ctx) (map[string]any, error) {
	var body struct {
		Key      string `json:"key"`
		UploadID string `json:"uploadId"`
		Parts    []struct {
			ETag       *string `json:"ETag"`
			PartNumber any     `json:"PartNumber"`
		} `json:"parts"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	parts := make([]types.CompletedPart, 0, len(body.Parts))
	for _, p := range body.Parts {
		parts = append(parts, types.CompletedPart{ETag: p.ETag, PartNumber: aws.Int32(jsInt(p.PartNumber))})
	}

	client := r2()
	response, err := client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket: bucket(), Key: aws.String(body.Key), UploadId: aws.String(body.UploadID),
		MultipartUpload: &types.CompletedMultipartUpload{Parts: parts},
	})
	if err != nil {
		return nil, fail(c, err)
	}

	remove := func() error {
		_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: bucket(), Key: aws.String(body.Key)})
		return err
	}

	safeExt := normalizeExtension(body.Key)
	if safeExt == "" {
		if err := remove(); err != nil {
			return nil, fail(c, err)
		}
		c.JSON(http.StatusBadRequest, map[string]any{"message": "Unsupported file type."})
		return nil, nil
	}
	expectedMime := multipartExtToMime(safeExt)

	head, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: bucket(), Key: aws.String(body.Key), Range: aws.String("bytes=0-4100"),
	})
	if err != nil {
		return nil, fail(c, err)
	}
	prefix, err := io.ReadAll(head.Body)
	head.Body.Close()
	if err != nil {
		return nil, fail(c, err)
	}
	detected := DetectFileType(prefix)

	// .mov and .mp4 are the same ISO BMFF family: a .mov with an ISO brand
	// sniffs as video/mp4 and a QuickTime-brand file is often named .mp4.
	// The normalizer reads both and always writes an mp4, so accept both
	// for either extension whenever it is on; without it .mp4 stays strict.
	accepted := []string{expectedMime}
	if ProcessorEnabled() && (safeExt == ".mov" || safeExt == ".mp4") {
		accepted = []string{"video/quicktime", "video/mp4"}
	}
	ok := false
	for _, mime := range accepted {
		ok = ok || detected != nil && detected.Mime == mime
	}
	if !ok {
		if err := remove(); err != nil {
			return nil, fail(c, err)
		}
		c.JSON(http.StatusBadRequest, map[string]any{"message": "File contents do not match declared type."})
		return nil, nil
	}

	location := ""
	if response.Location != nil {
		location = *response.Location
	}
	result := map[string]any{
		"$metadata": map[string]any{"httpStatusCode": 200},
		"Location":  os.Getenv("CLOUDFLARE_BUCKET_URL") + "/" + location[strings.LastIndex(location, "/")+1:],
	}
	for key, value := range map[string]*string{"Bucket": response.Bucket, "Key": response.Key, "ETag": response.ETag, "VersionId": response.VersionId} {
		if value != nil {
			result[key] = *value
		}
	}
	return result, nil
}

func abortMultipartUpload(ctx context.Context, c *httpx.Ctx) error {
	var body keyUpload
	if err := c.Decode(&body); err != nil {
		return err
	}
	if _, err := r2().AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket: bucket(), Key: aws.String(body.Key), UploadId: aws.String(body.UploadID),
	}); err != nil {
		return fail(c, err)
	}
	c.JSON(http.StatusOK, map[string]any{"$metadata": map[string]any{"httpStatusCode": 204}})
	return nil
}

func signPart(ctx context.Context, c *httpx.Ctx) error {
	var body struct {
		keyUpload
		PartNumber any `json:"partNumber"`
	}
	if err := c.Decode(&body); err != nil {
		return err
	}
	req, err := s3.NewPresignClient(r2()).PresignUploadPart(ctx, &s3.UploadPartInput{
		Bucket:     bucket(),
		Key:        aws.String(body.Key),
		PartNumber: aws.Int32(jsInt(body.PartNumber)),
		UploadId:   aws.String(body.UploadID),
	}, s3.WithPresignExpires(time.Hour))
	if err != nil {
		return err
	}
	c.JSON(http.StatusOK, map[string]any{"url": req.URL})
	return nil
}

package product

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/medialimits"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/disintegration/imaging"
)

// providerImage produces a bounded, oriented derivative. PNG preserves alpha;
// JPEG re-encodes at explicit quality. The original is never overwritten.
func providerImage(body []byte, mime string, limit int) (result []byte, resultMIME string, width, height int, err error) {
	return providerImageForProfile(body, mime, medialimits.ImageProfile{MaxBytes: limit, MaxEdge: 4096})
}

func providerImageForProfile(body []byte, mime string, profile medialimits.ImageProfile) ([]byte, string, int, int, error) {
	if _, err := decodeAssetDimensions(bytes.NewReader(body)); err != nil {
		return nil, "", 0, 0, err
	}
	picture, err := imaging.Decode(bytes.NewReader(body), imaging.AutoOrientation(true))
	if err != nil {
		return nil, "", 0, 0, invalid("The image could not be decoded.")
	}
	var current image.Image = imaging.Fit(picture, profile.MaxEdge, profile.MaxEdge, imaging.Lanczos)
	outputType := "image/png"
	if mime == "image/jpeg" {
		outputType = mime
	}
	for attempt := 0; attempt < 12; attempt++ {
		var encoded bytes.Buffer
		if outputType == "image/jpeg" {
			err = jpeg.Encode(&encoded, current, &jpeg.Options{Quality: 88})
		} else {
			err = png.Encode(&encoded, current)
		}
		if err != nil {
			return nil, "", 0, 0, err
		}
		if encoded.Len() <= profile.MaxBytes {
			return encoded.Bytes(), outputType, current.Bounds().Dx(), current.Bounds().Dy(), nil
		}
		width, height := current.Bounds().Dx()*3/4, current.Bounds().Dy()*3/4
		if width < 32 || height < 32 {
			break
		}
		current = imaging.Resize(current, width, height, imaging.Lanczos)
	}
	return nil, "", 0, 0, invalid("The image could not be resized within the provider's limit.")
}

// prepareDraftImages resolves provider derivatives before the schedule transaction.
// Admission and execution still validate the persisted derivative and account.
func (c *Configuration) prepareDraftImages(ctx context.Context, actor Actor, targets []ContentDraftScheduleTarget, fallback []string) error {
	for i := range targets {
		target := &targets[i]
		connection, err := c.client.ChannelConnection.Query().Where(channelconnection.ID(target.ChannelConnectionID), channelconnection.OrganizationID(actor.OrganizationID)).Only(ctx)
		if ent.IsNotFound(err) {
			return publishing.ErrNotFound
		}
		if err != nil {
			return err
		}
		profile, supported := medialimits.Limits.ImageProfiles[connection.Platform]
		if !supported {
			continue
		}
		prepare := func(ids []string) ([]string, error) {
			result := append([]string{}, ids...)
			for at, id := range ids {
				row, err := c.client.Asset.Query().Where(asset.ID(id), asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED)).Only(ctx)
				if err != nil {
					return nil, invalid("Choose uploaded assets from this workspace.")
				}
				if row.MediaType != "image/jpeg" && row.MediaType != "image/png" && row.MediaType != "image/webp" {
					continue
				}
				needs := row.Bytes > profile.MaxBytes || !slices.Contains(profile.Formats, row.MediaType) ||
					row.Width == nil || row.Height == nil || *row.Width > profile.MaxEdge || *row.Height > profile.MaxEdge
				// JPEG EXIF can rotate/mirror an otherwise small source. Decode with
				// orientation before scheduling, then strip stale orientation metadata.
				var source []byte
				if row.MediaType == "image/jpeg" {
					if c.objects == nil {
						return nil, conflict("Media storage is unavailable. Retry before scheduling.")
					}
					source, err = c.objects.Read(ctx, row.ObjectKey)
					if err != nil {
						return nil, err
					}
					needs = needs || bytes.Contains(source, []byte("Exif\x00\x00"))
				}
				if !needs {
					continue
				}
				name := fmt.Sprintf("provider-image-v2-%s-%d-%d.png", connection.Platform, profile.MaxBytes, profile.MaxEdge)
				if row.MediaType == "image/jpeg" {
					name = strings.TrimSuffix(name, "png") + "jpg"
				}
				cached, err := c.client.Asset.Query().Where(asset.ParentAssetID(id), asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED), asset.ObjectKeyHasSuffix("/"+name)).First(ctx)
				if err == nil {
					update := cached.Update()
					if row.AltText == nil {
						update.ClearAltText()
					} else {
						update.SetAltText(*row.AltText)
					}
					if _, err = update.Save(ctx); err != nil {
						return nil, err
					}
					result[at] = cached.ID
					continue
				}
				if !ent.IsNotFound(err) {
					return nil, err
				}
				if c.objects == nil {
					return nil, conflict("The image needs resizing, but media storage is unavailable. Retry before scheduling.")
				}
				if source == nil {
					source, err = c.objects.Read(ctx, row.ObjectKey)
					if err != nil {
						return nil, err
					}
				}
				body, mime, width, height, err := providerImageForProfile(source, row.MediaType, profile)
				if err != nil {
					return nil, err
				}
				stored, err := c.storeGeneratedAsset(ctx, actor, GeneratedAssetInput{Body: body, Classification: "derived", ContentType: mime, FileName: name, Width: width, Height: height, ParentAssetID: id})
				if err != nil {
					return nil, err
				}
				result[at] = stored.ID
			}
			return result, nil
		}
		ids := target.AssetIDs
		if ids == nil {
			ids = fallback
		}
		target.AssetIDs, err = prepare(ids)
		if err != nil {
			return err
		}
		for j := range target.Replies {
			target.Replies[j].AssetIDs, err = prepare(target.Replies[j].AssetIDs)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

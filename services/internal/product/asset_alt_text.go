package product

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// assetAltTextLimit is X's limit, the stricter of the platforms Write posts
// images to (LinkedIn takes 4,086).
const assetAltTextLimit = 1_000

// AssetAltText is an image's description as the API returns it.
type AssetAltText struct {
	AltText *string `json:"altText"`
	ID      string  `json:"id"`
}

// SetAssetAltText describes one of the workspace's images (RFC 041). The
// description goes out with the image wherever it is posted; empty clears it.
func (c *Configuration) SetAssetAltText(ctx context.Context, actor Actor, assetID, altText string) (*AssetAltText, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	altText = strings.TrimSpace(altText)
	if utf8.RuneCountInString(altText) > assetAltTextLimit {
		return nil, invalid("Keep the description under 1,000 characters, X's limit.")
	}
	row, err := c.client.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(row.MediaType, "image/") {
		return nil, invalid("Only images take a description.")
	}
	update := row.Update()
	if altText == "" {
		update.ClearAltText()
	} else {
		update.SetAltText(altText)
	}
	saved, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	return &AssetAltText{AltText: saved.AltText, ID: saved.ID}, nil
}

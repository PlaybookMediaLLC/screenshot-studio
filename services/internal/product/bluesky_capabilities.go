package product

import (
	"context"
	"encoding/json"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// checkBlueskyTarget checks the original selection before the shared scheduler
// applies per-channel media limits. Unsupported content must never be dropped.
func checkBlueskyTarget(ctx context.Context, tx *ent.Tx, connection *ent.ChannelConnection, target ContentDraftScheduleTarget, ids []string) error {
	var caps *socialidentity.BlueskyCapabilities
	err := tx.Client().PlatformQuery(ctx, `SELECT i."internalId", i."verifiedAccountKey", i."verifiedAccountKind",
		i."verifiedScopes", i."verifiedCapabilities", i."identityVerifiedAt"
		FROM channel_connection c
		JOIN social_tenant_binding b ON b."organizationId" = c."organizationId"
		JOIN "Integration" i ON i.id = c."externalAccountId" AND i."organizationId" = b."goOrganizationId"
		WHERE c.id = $1 AND c."organizationId" = $2 AND c.provider = 'social' AND i."providerIdentifier" = 'bluesky'`,
		[]any{connection.ID, connection.OrganizationID}, func(row entsql.ColumnScanner) error {
			var native string
			var key, kind *string
			var scopes, capabilities []byte
			var verified *time.Time
			if err := row.Scan(&native, &key, &kind, &scopes, &capabilities, &verified); err != nil {
				return err
			}
			if key == nil || kind == nil || verified == nil {
				return nil
			}
			proof := socialidentity.Verification{AccountKey: *key, AccountKind: *kind}
			if json.Unmarshal(scopes, &proof.GrantedScopes) == nil && json.Unmarshal(capabilities, &proof.Capabilities) == nil && proof.Validate("bluesky", native) == nil {
				caps = proof.Capabilities.Bluesky
			}
			return nil
		})
	if err != nil {
		return err
	}
	if caps == nil {
		return conflict("Reconnect Bluesky to verify this account's publishing permissions and limits.")
	}
	check := func(text string, ids []string) error {
		if err := socialidentity.CheckBlueskyText(text); err != nil {
			return conflict(err.Error())
		}
		if len(ids) > caps.MaxImages {
			return conflict("Choose up to four images or one MP4 video for each Bluesky post.")
		}
		if _, err := contentDraftAssets(ctx, tx, connection.OrganizationID, ids); err != nil {
			return err
		}
		media := make([]socialidentity.BlueskyMedia, 0, len(ids))
		if len(ids) > 0 {
			rows, err := tx.Asset.Query().Where(asset.OrganizationID(connection.OrganizationID), asset.IDIn(ids...), asset.StatusEQ(asset.StatusUPLOADED)).All(ctx)
			if err != nil {
				return err
			}
			if len(rows) != len(ids) {
				return invalid("Select distinct uploaded files from this workspace.")
			}
			for _, row := range rows {
				media = append(media, socialidentity.BlueskyMedia{MIME: row.MediaType, Bytes: int64(row.Bytes)})
			}
		}
		if err := socialidentity.CheckBlueskyMedia(*caps, media); err != nil {
			return conflict(err.Error())
		}
		return nil
	}
	if err := check(target.Caption, ids); err != nil {
		return err
	}
	for _, reply := range target.Replies {
		if err := check(reply.Caption, reply.AssetIDs); err != nil {
			return err
		}
	}
	return nil
}

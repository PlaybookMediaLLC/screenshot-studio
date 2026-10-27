package product

import (
	"context"
	"encoding/json"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	"time"
)

func checkMastodonPolls(ctx context.Context, tx *ent.Tx, connection *ent.ChannelConnection, target ContentDraftScheduleTarget, ids []string) error {
	quotes := target.Options != nil && (target.Options.QuoteRemoteID != "" || target.Options.QuoteFirstPost)
	has := target.Poll != nil
	for _, reply := range target.Replies {
		has = has || reply.Poll != nil
		quotes = quotes || reply.Options != nil && (reply.Options.QuoteRemoteID != "" || reply.Options.QuoteFirstPost)
	}
	if !has && !quotes {
		return nil
	}
	var limits *socialidentity.PollLimits
	canQuote := false
	err := tx.Client().PlatformQuery(ctx, `SELECT i."internalId",i."verifiedAccountKey",i."verifiedAccountKind",i."verifiedScopes",i."verifiedCapabilities",i."identityVerifiedAt" FROM "Integration" i JOIN social_tenant_binding b ON b."goOrganizationId"=i."organizationId" WHERE b."organizationId"=$1 AND i.id=$2 AND i."providerIdentifier"='mastodon-custom'`, []any{connection.OrganizationID, connection.ExternalAccountID}, func(row entsql.ColumnScanner) error {
		var id string
		var key, kind *string
		var scopes, caps []byte
		var at *time.Time
		if err := row.Scan(&id, &key, &kind, &scopes, &caps, &at); err != nil {
			return err
		}
		if key == nil || kind == nil || at == nil {
			return nil
		}
		proof := socialidentity.Verification{AccountKey: *key, AccountKind: *kind}
		if json.Unmarshal(scopes, &proof.GrantedScopes) == nil && json.Unmarshal(caps, &proof.Capabilities) == nil && proof.Validate("mastodon-custom", id) == nil {
			limits = proof.Capabilities.Polls
			canQuote = socialidentity.CanQuoteMastodon(proof.Capabilities, proof.GrantedScopes)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if quotes && !canQuote {
		return invalid("Reconnect to a Mastodon server with native quotes and read:search/read:statuses permissions.")
	}
	if target.Poll != nil {
		if err := limits.Check(target.Poll.Options, target.Poll.DurationMinutes, len(ids)); err != nil {
			return invalid(err.Error())
		}
	}
	for _, reply := range target.Replies {
		if reply.Poll != nil {
			if err := limits.Check(reply.Poll.Options, reply.Poll.DurationMinutes, len(reply.AssetIDs)); err != nil {
				return invalid(err.Error())
			}
		}
	}
	return nil
}

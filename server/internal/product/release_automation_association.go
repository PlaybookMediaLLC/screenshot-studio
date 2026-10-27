package product

import (
	"context"
	"time"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqljson"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/release"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourcechange"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releasenotes"
)

// Caller holds the source row lock shared with release creation. Explicit PR
// references and provider occurrence times establish membership, never arrival.
func associateLateSourceChange(ctx context.Context, tx *ent.Tx, actor Actor, source *ent.SourceApp, input CollectSourceChangeInput, changeID string) error {
	candidates, err := tx.OutboxEvent.Query().Where(outboxevent.OrganizationID(actor.OrganizationID), outboxevent.Type("release.ingested"), func(s *sql.Selector) {
		s.Where(sqljson.ValueEQ(outboxevent.FieldPayload, input.SourceAppID, sqljson.Path("sourceAppId")))
		s.Where(sqljson.ValueEQ(outboxevent.FieldPayload, input.RepositoryID, sqljson.Path("associationRepository")))
		s.Where(sqljson.ValueContains(outboxevent.FieldPayload, input.Number, sqljson.Path("associationNumbers")))
	}).Limit(101).All(ctx)
	if err != nil {
		return err
	}
	if len(candidates) > 100 {
		return appendConfigurationAudit(ctx, tx, actor, "product.source_change_association_unresolved", "source_change", changeID, map[string]any{"reason": "Too many explicit release references; manual association required."})
	}
	var selected *ent.OutboxEvent
	for _, candidate := range candidates {
		text, _ := candidate.Payload["associationCutoff"].(string)
		cutoff, err := time.Parse(time.RFC3339Nano, text)
		if err != nil || input.MergedAt.After(cutoff) {
			continue
		}
		if selected != nil {
			return appendConfigurationAudit(ctx, tx, actor, "product.source_change_association_unresolved", "source_change", changeID, map[string]any{"reason": "Multiple releases explicitly reference this PR; no arrival-order guess was made."})
		}
		selected = candidate
	}
	if selected == nil {
		return nil
	}
	// A release may have been removed independently of its durable intake key.
	n, err := tx.Release.Update().Where(release.ID(selected.AggregateID), release.OrganizationID(actor.OrganizationID)).SetUpdatedAt(time.Now()).Save(ctx)
	if err != nil || n == 0 {
		return err
	}
	row, err := tx.Release.Query().Where(release.ID(selected.AggregateID), release.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.SourceChange.Update().Where(sourcechange.ID(changeID), sourcechange.OrganizationID(actor.OrganizationID), sourcechange.ReleaseIDIsNil()).SetReleaseID(row.ID).Save(ctx); err != nil {
		return err
	}
	named := false
	for _, feature := range row.Features {
		named = named || feature.Number == input.Number
	}
	if !named && len(row.Features) < releasenotes.MaxFeatures && !ignoresAuthor(source, optionalText(input.AuthorLogin)) {
		kind, title := releasenotes.Title(input.Title)
		features := append(row.Features, releasenotes.Feature{Kind: kind, Title: title, Number: input.Number, URL: input.URL, Author: optionalText(input.AuthorLogin)})
		if err := row.Update().SetFeatures(features).Exec(ctx); err != nil {
			return err
		}
	}
	return appendConfigurationAudit(ctx, tx, actor, "product.source_change_associated", "source_change", changeID, map[string]any{"releaseId": row.ID, "reason": "Explicit PR reference and provider occurrence time."})
}

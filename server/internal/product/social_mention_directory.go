package product

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

// rememberDraftMentions commits lookup history with the accepted draft version.
// Failed/stale saves cannot pollute it; deleting a draft does not erase it.
func rememberDraftMentions(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft) error {
	if draft.SocialSetID == nil {
		return nil
	}
	bodies := [][]any{draft.Body}
	for _, version := range draft.PlatformVersions.Versions {
		bodies = append(bodies, version.Body)
	}
	mentions := append(storedMentions(bodies, "", "organization"), storedMentions(bodies, "", "person")...)
	if len(mentions) == 0 {
		return nil
	}
	// Use one statement and stable lock order for concurrent saves mentioning the same accounts.
	sort.Slice(mentions, func(i, j int) bool {
		return mentions[i].Kind+mentions[i].ProviderID < mentions[j].Kind+mentions[j].ProviderID
	})
	data, err := json.Marshal(mentions)
	if err != nil {
		return err
	}
	_, err = tx.PlatformExec(ctx, `INSERT INTO platform_social_mention (id,"organizationId","socialSetId",kind,"providerId",label,"lastUsedAt")
 SELECT md5($1||chr(31)||$2||chr(31)||(item->>'kind')||chr(31)||(item->>'providerId')),
 $1,$2,item->>'kind',item->>'providerId',item->>'label',$3
 FROM jsonb_array_elements($4::jsonb) item
 ON CONFLICT ("organizationId","socialSetId",kind,"providerId") DO UPDATE
 SET label=CASE WHEN EXCLUDED."lastUsedAt">=platform_social_mention."lastUsedAt" THEN EXCLUDED.label ELSE platform_social_mention.label END,
 "lastUsedAt"=GREATEST(EXCLUDED."lastUsedAt",platform_social_mention."lastUsedAt")`, draft.OrganizationID, *draft.SocialSetID, draft.UpdatedAt, string(data))
	return err
}

// mentionDirectory searches all remembered identities, returning a bounded page
// of recent matches. The caller has already checked visibility of this exact set.
func (c *Configuration) mentionDirectory(ctx context.Context, actor Actor, setID, query, kind string) ([]Mention, error) {
	query = strings.TrimSpace(query)
	// A pasted company URL, vanity name or native identity remains searchable.
	if kind == "organization" {
		if normalized, err := mentionQuery("linkedin", query); err == nil {
			query = normalized
		}
	}
	out := []Mention{}
	err := c.client.PlatformQuery(ctx, `SELECT kind,label,"providerId" FROM platform_social_mention
 WHERE "organizationId"=$1 AND "socialSetId"=$2 AND kind=$3
 AND ($4='' OR strpos(lower(label),lower($4))>0 OR strpos(lower("providerId"),lower($4))>0)
 ORDER BY "lastUsedAt" DESC,"providerId" ASC LIMIT 30`, []any{actor.OrganizationID, setID, kind, query}, func(row entsql.ColumnScanner) error {
		var item Mention
		if err := row.Scan(&item.Kind, &item.Label, &item.ProviderID); err != nil {
			return err
		}
		out = append(out, item)
		return nil
	})
	return out, err
}

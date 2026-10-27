package product

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

func creativeSetFixture(assetID string) map[string]any {
	outputs := []any{}
	for _, format := range []string{"wide", "square", "portrait"} {
		outputs = append(outputs, map[string]any{"id": format, "kind": "design", "format": format, "document": map[string]any{"version": float64(2), "image": map[string]any{"src": "asset:" + assetID}}})
	}
	return map[string]any{"version": float64(1), "story": map[string]any{"id": "story", "headline": "Approvals, together", "supporting": "", "source": map[string]any{"id": "source", "revision": float64(1), "src": "asset:" + assetID}, "focus": map[string]any{"x": .1, "y": .2, "width": .3, "height": .3}}, "outputs": outputs}
}

func TestCreativeSetValidation(t *testing.T) {
	id := uuid.NewString()
	valid := creativeSetFixture(id)
	ids, err := creativeSetAssetIDs(valid)
	if err != nil || len(ids) != 1 || ids[0] != id {
		t.Fatalf("ids=%v err=%v", ids, err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"future version": func(doc map[string]any) { doc["version"] = float64(2) },
		"blob evidence": func(doc map[string]any) {
			doc["story"].(map[string]any)["source"].(map[string]any)["src"] = "blob:local"
		},
		"invalid focus":    func(doc map[string]any) { doc["story"].(map[string]any)["focus"].(map[string]any)["width"] = 1.0 },
		"duplicate format": func(doc map[string]any) { outputs := doc["outputs"].([]any); outputs[1] = outputs[0] },
		"nested local image": func(doc map[string]any) {
			doc["outputs"].([]any)[0].(map[string]any)["document"].(map[string]any)["overlays"] = []any{map[string]any{"src": "blob:local"}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			doc := creativeSetFixture(id)
			mutate(doc)
			if _, err := creativeSetAssetIDs(doc); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
}

func TestCreativeSetRevisionAndIsolation(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	t.Setenv("PLATFORM_CREATIVE_SETS", "enabled")
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var databaseName string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&databaseName); err != nil || !strings.Contains(databaseName, "test") {
		t.Fatalf("refusing database %q", databaseName)
	}
	org, other := "sets_"+cuid.New(), "other_"+cuid.New()
	for _, id := range []string{org, other} {
		if _, err := db.SQL.ExecContext(ctx, `INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now());`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL.ExecContext(ctx, `INSERT INTO workspace_entitlement("organizationId",plan,status,"updatedAt") VALUES($1,'pro','active',now())`, id); err != nil {
			t.Fatal(err)
		}
	}
	a, b := uuid.NewString(), uuid.NewString()
	for id, owner := range map[string]string{a: org, b: other} {
		if err := db.Client.Asset.Create().SetID(id).SetOrganizationID(owner).SetObjectKey("org/" + owner + "/input/" + id + "/1/screen.png").SetMediaType("image/png").SetBytes(100).SetStatus(asset.StatusUPLOADED).Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewConfiguration(db.Client)
	actor := Actor{Kind: "service", OrganizationID: org}
	stranger := Actor{Kind: "service", OrganizationID: other}
	id := cuid.New()
	document := creativeSetFixture(a)
	created, err := repo.CreateCreativeSet(ctx, actor, id, "Launch", document)
	if err != nil || created.Revision != 1 {
		t.Fatalf("create=%+v err=%v", created, err)
	}
	replay, err := repo.CreateCreativeSet(ctx, actor, id, "Launch", document)
	if err != nil || replay.ID != id || replay.Revision != 1 {
		t.Fatalf("replayed create=%+v err=%v", replay, err)
	}
	versions, err := repo.ListCreativeSetVersions(ctx, actor, id)
	if err != nil || len(versions) != 1 {
		t.Fatalf("versions=%v err=%v", versions, err)
	}
	originalVersion := versions[0].ID
	if _, err := repo.GetCreativeSet(ctx, stranger, id); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("cross-tenant read: %v", err)
	}
	if _, err := repo.GetCreativeSetVersion(ctx, stranger, id, originalVersion); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("cross-tenant version: %v", err)
	}
	if _, err := repo.UpdateCreativeSetDocument(ctx, stranger, id, CreativeSetDocumentWrite{BaseRevision: 1, Document: creativeSetFixture(b)}); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("cross-tenant update: %v", err)
	}
	nested := creativeSetFixture(a)
	nested["outputs"].([]any)[1].(map[string]any)["document"].(map[string]any)["overlays"] = []any{map[string]any{"src": "asset:" + b}}
	if _, err := repo.CreateCreativeSet(ctx, actor, cuid.New(), "Foreign source", nested); err == nil {
		t.Fatal("foreign nested asset accepted")
	}
	storeFixture := func(ref string) map[string]any {
		doc := creativeSetFixture(a)
		doc["storeGroups"] = []any{map[string]any{"id": "store", "kind": "store", "bindings": []any{}, "assetMap": map[string]any{"screen": "asset:" + ref}, "document": map[string]any{"version": float64(2), "assets": map[string]any{"screen": map[string]any{"id": "screen", "src": nil}}, "slides": []any{map[string]any{"id": "slide", "layers": []any{}}}}}}
		return doc
	}
	if _, err := repo.CreateCreativeSet(ctx, actor, cuid.New(), "Foreign store asset", storeFixture(b)); err == nil {
		t.Fatal("foreign store asset accepted")
	}
	ownedStore, err := repo.CreateCreativeSet(ctx, actor, cuid.New(), "Owned store asset", storeFixture(a))
	if err != nil {
		t.Fatalf("owned store asset rejected: %v", err)
	}
	if err := repo.ArchiveCreativeSet(ctx, actor, ownedStore.ID); err != nil {
		t.Fatal(err)
	}
	definition := func(ref string) map[string]any {
		return map[string]any{"kind": "story-reusable", "version": float64(1), "scope": "composition", "document": map[string]any{"version": float64(2), "image": map[string]any{"src": "asset:" + ref}}}
	}
	if _, err := repo.CreateCreativeTemplate(ctx, actor, CreateCreativeTemplateInput{Name: "Foreign block", Definition: definition(b)}); err == nil {
		t.Fatal("foreign published block asset accepted")
	}
	foreignTemplate, err := repo.CreateCreativeTemplate(ctx, stranger, CreateCreativeTemplateInput{Name: "Other block", Definition: definition(b)})
	if err != nil {
		t.Fatal(err)
	}
	pinned := creativeSetFixture(a)
	pinned["outputs"].([]any)[0].(map[string]any)["reusable"] = []any{map[string]any{"id": foreignTemplate.ID, "version": float64(foreignTemplate.Version)}}
	if _, err := repo.CreateCreativeSet(ctx, actor, cuid.New(), "Foreign block pin", pinned); err == nil {
		t.Fatal("foreign published block pin accepted")
	}
	if result, err := repo.DeleteAsset(ctx, stranger, b); err != nil || result != AssetInUse {
		t.Fatalf("published block source deletion=%s %v", result, err)
	}
	changed := creativeSetFixture(a)
	changed["story"].(map[string]any)["headline"] = "Changed"
	saved, err := repo.UpdateCreativeSetDocument(ctx, actor, id, CreativeSetDocumentWrite{BaseRevision: 1, Document: changed})
	if err != nil || saved.Revision != 2 {
		t.Fatalf("save=%+v err=%v", saved, err)
	}
	if _, err := repo.UpdateCreativeSetDocument(ctx, actor, id, CreativeSetDocumentWrite{BaseRevision: 1, Document: document}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("stale update=%v", err)
	}
	restored, err := repo.RestoreCreativeSetVersion(ctx, actor, id, originalVersion, 2)
	if err != nil || restored.Revision != 3 {
		t.Fatalf("restore=%+v err=%v", restored, err)
	}
	before, _ := json.Marshal(document)
	after, _ := json.Marshal(restored.Document)
	if string(before) != string(after) {
		t.Fatal("restore changed the snapshot")
	}
	if result, err := repo.DeleteAsset(ctx, actor, a); err != nil || result != AssetInUse {
		t.Fatalf("retained source deletion=%s %v", result, err)
	}
	if err := repo.ArchiveCreativeSet(ctx, actor, id); err != nil {
		t.Fatal(err)
	}
	if record, err := repo.GetCreativeSet(ctx, actor, id); err != nil || !record.Archived {
		t.Fatalf("archived access=%+v %v", record, err)
	}
	if list, err := repo.ListCreativeSets(ctx, actor, CreativeSetListQuery{}); err != nil || len(list.Items) != 0 {
		t.Fatalf("archived list=%+v %v", list, err)
	}
	t.Setenv("PLATFORM_CREATIVE_SETS", "disabled")
	if _, err := repo.CreateCreativeSet(ctx, actor, cuid.New(), "Disabled", document); err == nil {
		t.Fatal("creation survived rollback")
	}
	if _, err := repo.GetCreativeSet(ctx, actor, id); err != nil {
		t.Fatalf("rollback hid a saved set: %v", err)
	}
}

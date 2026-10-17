package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/lucsky/cuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/release"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/capture"
	platformdb "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type memoryCounter struct {
	sync.Mutex
	counts map[string]int
}

func (c *memoryCounter) Increment(_ context.Context, key string, amount int, _ time.Duration) (int, error) {
	c.Lock()
	defer c.Unlock()
	if c.counts == nil {
		c.counts = map[string]int{}
	}
	c.counts[key] += amount
	return c.counts[key], nil
}

func (c *memoryCounter) consumed(prefix string) int {
	c.Lock()
	defer c.Unlock()
	total := 0
	for key, count := range c.counts {
		if strings.HasPrefix(key, prefix) {
			total += count
		}
	}
	return total
}

type memoryObjects struct{}

func (memoryObjects) SignUpload(_ context.Context, key, _ string) (string, error) {
	return "https://storage.test/upload/" + key, nil
}
func (memoryObjects) SignDownload(_ context.Context, key string) (string, error) {
	return "https://storage.test/download/" + key, nil
}
func (memoryObjects) Exists(context.Context, string) (bool, error)         { return true, nil }
func (memoryObjects) Put(context.Context, string, string, io.Reader) error { return nil }
func (memoryObjects) Read(context.Context, string) ([]byte, error)         { return nil, nil }
func (memoryObjects) Delete(context.Context, string) error                 { return nil }

type fakeCapture struct{ pages []string }

func (f *fakeCapture) CaptureWith(_ context.Context, pageURL string, _ capture.Options) ([]byte, error) {
	f.pages = append(f.pages, pageURL)
	return []byte("\x89PNG\r\n\x1a\n0000"), nil
}

// fixture is two paying workspaces and one without a plan, each with keys.
type fixture struct {
	t        *testing.T
	ctx      context.Context
	db       *platformdb.Database
	product  *product.Configuration
	counter  *memoryCounter
	capture  *fakeCapture
	server   *httptest.Server
	id       string
	orgs     map[string]string
	keys     map[string]string
	keyNames map[string]string
}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	t.Setenv("PLATFORM_CAMPAIGN_WORKFLOW", "")
	t.Setenv("PLATFORM_MCP_URL", "https://api.shots.test/mcp")
	t.Setenv("FRONTEND_URL", "https://shots.test")
	ctx := context.Background()
	db, err := platformdb.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	f := &fixture{t: t, ctx: ctx, db: db, counter: &memoryCounter{}, capture: &fakeCapture{}, id: cuid.New(),
		orgs: map[string]string{}, keys: map[string]string{}, keyNames: map[string]string{}}
	f.product = product.NewConfiguration(db.Client).WithObjectStore(memoryObjects{}).WithQuotaCounter(f.counter)
	for _, workspace := range []string{"a", "b", "free"} {
		org := "org_" + workspace + "_" + f.id
		f.orgs[workspace] = org
		f.exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, org)
		if workspace != "free" {
			f.exec(`INSERT INTO workspace_entitlement ("organizationId", plan, status, "updatedAt") VALUES ($1,'pro','active',now())`, org)
		}
	}
	t.Cleanup(func() {
		for _, org := range f.orgs {
			_, _ = db.SQL.ExecContext(ctx, `DELETE FROM apikey WHERE "referenceId"=$1`, org)
			_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, org)
		}
	})
	all := `{"artifact":["read"],"asset":["write"],"release":["create"],"source":["write"],"upload":["sign"]}`
	f.key("a", "a", all, true)
	f.key("a-read", "a", `{"artifact":["read"]}`, true)
	f.key("a-off", "a", all, false)
	f.key("b", "b", all, true)
	f.key("free", "free", all, true)
	s, err := New(Config{Product: f.product, Capture: f.capture, Limiter: f.counter})
	if err != nil {
		t.Fatal(err)
	}
	f.server = httptest.NewServer(s.Handler(http.NotFoundHandler()))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.db.SQL.ExecContext(f.ctx, query, args...); err != nil {
		f.t.Fatalf("%v\n%s", err, query)
	}
}

func (f *fixture) key(label, workspace, permissions string, enabled bool) {
	raw := "ss_" + label + "_" + f.id
	id := "key_" + strings.ReplaceAll(label, "-", "_") + "_" + f.id
	f.keys[label], f.keyNames[label] = raw, "Key "+label
	f.exec(`INSERT INTO apikey (id,"referenceId",key,name,start,prefix,enabled,permissions,"createdAt","updatedAt")
		VALUES ($1,$2,$3,$4,$5,'ss_',$6,$7,now(),now())`, id, f.orgs[workspace], hashKey(raw), f.keyNames[label], raw[:6], enabled, permissions)
}

func (f *fixture) actor(label string) product.Actor {
	key, err := f.product.VerifyAPIKey(f.ctx, f.keys[label])
	if err != nil {
		f.t.Fatalf("%s: %v", label, err)
	}
	return key.Actor("fixture-" + f.id)
}

type headers map[string]string

func (h headers) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	for name, value := range h {
		request.Header.Set(name, value)
	}
	return http.DefaultTransport.RoundTrip(request)
}

func (f *fixture) session(label string, extra ...string) *sdk.ClientSession {
	f.t.Helper()
	set := headers{"Authorization": "Bearer " + f.keys[label]}
	for i := 0; i+1 < len(extra); i += 2 {
		set[extra[i]] = extra[i+1]
	}
	client := sdk.NewClient(&sdk.Implementation{Name: "shots-test", Version: "1"}, nil)
	session, err := client.Connect(f.ctx, &sdk.StreamableClientTransport{Endpoint: f.server.URL + "/mcp",
		HTTPClient: &http.Client{Transport: set}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { _ = session.Close() })
	return session
}

// call runs a tool and returns its JSON body and whether it was an error.
func (f *fixture) call(session *sdk.ClientSession, tool string, args map[string]any) (map[string]any, bool) {
	f.t.Helper()
	result, err := session.CallTool(f.ctx, &sdk.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		f.t.Fatalf("%s: %v", tool, err)
	}
	body := map[string]any{}
	for _, content := range result.Content {
		if text, ok := content.(*sdk.TextContent); ok {
			_ = json.Unmarshal([]byte(text.Text), &body)
		}
	}
	if !result.IsError && result.StructuredContent != nil {
		f.checkOutput(tool, result.StructuredContent)
	}
	return body, result.IsError
}

// checkOutput validates a result against the REST operation's response
// schema: an agent gets exactly what the API documents.
func (f *fixture) checkOutput(tool string, value any) {
	f.t.Helper()
	tools, _ := buildTools()
	for _, candidate := range tools {
		if candidate.spec.Name != tool || candidate.spec.OutputSchema == nil {
			continue
		}
		data, _ := json.Marshal(candidate.spec.OutputSchema)
		var schema jsonschema.Schema
		_ = json.Unmarshal(data, &schema)
		resolved, err := schema.Resolve(nil)
		if err != nil {
			f.t.Fatalf("%s output schema: %v", tool, err)
		}
		encoded, _ := json.Marshal(value)
		var instance any
		_ = json.Unmarshal(encoded, &instance)
		if err := resolved.Validate(instance); err != nil {
			f.t.Fatalf("%s output does not match the REST response schema: %v\n%s", tool, err, encoded)
		}
	}
}

func refusedWith(t *testing.T, tool string, body map[string]any, isError bool, code string) {
	t.Helper()
	if !isError || body["code"] != code {
		t.Fatalf("%s: want %s, got isError=%v %v", tool, code, isError, body)
	}
}

// seed creates workspace B's records through the domain, the way REST would.
func (f *fixture) seed(label string) (releaseID, campaignID, assetID string) {
	f.t.Helper()
	actor := f.actor(label)
	created, err := f.product.CreateRelease(f.ctx, actor, product.CreateReleaseInput{Title: "Release " + label,
		BenefitStatement: "Faster exports", IdempotencyKey: "seed-" + label + f.id})
	if err != nil {
		f.t.Fatal(err)
	}
	campaign, err := f.product.CreateCampaign(f.ctx, actor, product.CreateCampaignInput{Name: "Campaign " + label,
		Objective: "Adoption", Posts: []product.CampaignPostInput{{Channel: "x", Copy: "Post " + label}}})
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.product.TransitionCampaignPosts(f.ctx, actor, campaign.ID, product.CampaignPostDecision{Decision: "submit"}); err != nil {
		f.t.Fatal(err)
	}
	upload, err := f.product.SignAssetUpload(f.ctx, actor, product.AssetUploadInput{Bytes: 10, ContentType: "image/png", FileName: "b.png"})
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.product.CompleteAssetUpload(f.ctx, actor, upload.Asset.ID, nil); err != nil {
		f.t.Fatal(err)
	}
	return created.Release.ID, campaign.ID, upload.Asset.ID
}

func ids(items any, path ...string) []string {
	found := []string{}
	list, _ := items.([]any)
	for _, item := range list {
		value := item
		for _, key := range path {
			value = value.(map[string]any)[key]
		}
		found = append(found, fmt.Sprint(value))
	}
	return found
}

// A key from workspace A reaches only A's records through every tool, and
// every identifier from workspace B is not found.
func TestEveryToolIsTenantIsolated(t *testing.T) {
	f := newFixture(t)
	otherRelease, otherCampaign, otherAsset := f.seed("b")
	ownRelease, ownCampaign, _ := f.seed("a")
	session := f.session("a")

	listed, err := session.ListTools(f.ctx, nil)
	if err != nil || len(listed.Tools) != 12 {
		t.Fatalf("tools/list: %d %v", len(listed.Tools), err)
	}

	body, isError := f.call(session, "listReleases", map[string]any{})
	releases := ids(body["releases"], "id")
	if isError || !slices.Contains(releases, ownRelease) || slices.Contains(releases, otherRelease) {
		t.Fatalf("listReleases: %v", body)
	}
	body, isError = f.call(session, "createRelease", map[string]any{"title": "Agent release", "benefitStatement": "Clearer"})
	created := body["release"].(map[string]any)["id"].(string)
	if isError || body["created"] != true ||
		f.db.Client.Release.Query().Where(release.ID(created), release.OrganizationID(f.orgs["a"])).CountX(f.ctx) != 1 {
		t.Fatalf("createRelease: %v", body)
	}

	body, isError = f.call(session, "createAssetUploadUrl", map[string]any{"bytes": 20, "contentType": "image/png", "fileName": "a.png"})
	ownAsset := body["asset"].(map[string]any)["id"].(string)
	if isError || f.db.Client.Asset.Query().Where(asset.ID(ownAsset), asset.OrganizationID(f.orgs["a"])).CountX(f.ctx) != 1 {
		t.Fatalf("createAssetUploadUrl: %v", body)
	}
	if body, isError = f.call(session, "completeAssetUpload", map[string]any{"assetId": ownAsset}); isError {
		t.Fatalf("completeAssetUpload: %v", body)
	}
	if body, isError = f.call(session, "createAssetDownloadUrl", map[string]any{"assetId": ownAsset}); isError || body["downloadUrl"] == "" {
		t.Fatalf("createAssetDownloadUrl: %v", body)
	}
	for _, tool := range []string{"completeAssetUpload", "createAssetDownloadUrl", "deleteAsset"} {
		body, isError = f.call(session, tool, map[string]any{"assetId": otherAsset})
		refusedWith(t, tool, body, isError, "not_found")
	}
	if f.db.Client.Asset.Query().Where(asset.ID(otherAsset), asset.StatusEQ(asset.StatusUPLOADED)).CountX(f.ctx) != 1 {
		t.Fatal("workspace B's asset changed")
	}

	body, isError = f.call(session, "listCampaigns", map[string]any{})
	campaigns := ids(body["data"], "id")
	if isError || !slices.Contains(campaigns, ownCampaign) || slices.Contains(campaigns, otherCampaign) {
		t.Fatalf("listCampaigns: %v", body)
	}
	if body, isError = f.call(session, "getCampaign", map[string]any{"campaignId": ownCampaign}); isError || body["id"] != ownCampaign {
		t.Fatalf("getCampaign: %v", body)
	}
	body, isError = f.call(session, "getCampaign", map[string]any{"campaignId": otherCampaign})
	refusedWith(t, "getCampaign", body, isError, "not_found")

	body, isError = f.call(session, "createCampaign", map[string]any{"name": "Agent campaign", "objective": "Adoption",
		"posts": []any{map[string]any{"channel": "linkedin", "copy": "Draft"}}, "idempotencyKey": "agent-" + f.id})
	agentCampaign := body["campaign"].(map[string]any)
	if isError || body["created"] != true || agentCampaign["organizationId"] != f.orgs["a"] {
		t.Fatalf("createCampaign: %v", body)
	}
	if _, has := agentCampaign["created"]; has {
		t.Fatal("a field outside the REST contract reached the agent")
	}
	body, _ = f.call(session, "createCampaign", map[string]any{"name": "Agent campaign", "objective": "Adoption",
		"idempotencyKey": "agent-" + f.id})
	if body["created"] != false || body["campaign"].(map[string]any)["id"] != agentCampaign["id"] {
		t.Fatalf("idempotent replay: %v", body)
	}

	body, isError = f.call(session, "listApprovals", map[string]any{})
	queued := ids(body["data"], "campaign", "id")
	if isError || !slices.Contains(queued, ownCampaign) || slices.Contains(queued, otherCampaign) {
		t.Fatalf("listApprovals: %v", body)
	}
	body, isError = f.call(session, "requestCampaignReview", map[string]any{"campaignId": otherCampaign})
	refusedWith(t, "requestCampaignReview", body, isError, "not_found")
	if body, isError = f.call(session, "requestCampaignReview", map[string]any{"campaignId": agentCampaign["id"]}); isError ||
		body["status"] != "READY_FOR_REVIEW" {
		t.Fatalf("requestCampaignReview: %v", body)
	}
	if f.db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(otherCampaign),
		campaignpost.StatusEQ(campaignpost.StatusREADY_FOR_REVIEW)).CountX(f.ctx) != 1 {
		t.Fatal("workspace B's posts changed")
	}

	result, err := session.CallTool(f.ctx, &sdk.CallToolParams{Name: "captureScreenshot",
		Arguments: map[string]any{"url": "https://example.com/pricing", "deviceType": "mobile"}})
	if err != nil || result.IsError || len(result.Content) != 2 || result.Content[0].(*sdk.ImageContent).MIMEType != "image/png" {
		t.Fatalf("captureScreenshot: %+v %v", result, err)
	}
	body, isError = f.call(session, "captureScreenshot", map[string]any{"url": "http://169.254.169.254/latest"})
	refusedWith(t, "captureScreenshot", body, isError, "invalid_request")
	if slices.Contains(f.capture.pages, "http://169.254.169.254/latest") {
		t.Fatal("a private address was sent to the screenshot service")
	}

	// Writes consumed the workspace's REST write quota.
	if f.counter.consumed("screenshot-studio:quota:api:write:minute:"+f.orgs["a"]) < 6 {
		t.Fatalf("write quota: %v", f.counter.counts)
	}
	// Deleting comes last: it is the one destructive tool.
	if body, isError = f.call(session, "deleteAsset", map[string]any{"assetId": ownAsset}); isError || body["accepted"] != true {
		t.Fatalf("deleteAsset: %v", body)
	}
}

func post(t *testing.T, url string, header ...string) (*http.Response, string) {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, url, bytes.NewBufferString(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	for i := 0; i+1 < len(header); i += 2 {
		request.Header.Set(header[i], header[i+1])
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response, string(body)
}

func TestUnauthenticatedAndInvalidKeysAreRefused(t *testing.T) {
	f := newFixture(t)
	for name, header := range map[string][]string{
		"no credential":           nil,
		"unknown key":             {"Authorization", "Bearer ss_unknown_" + f.id},
		"disabled key":            {"Authorization", "Bearer " + f.keys["a-off"]},
		"a Postiz OAuth token":    {"Authorization", "Bearer pos_" + f.id},
		"a key hash, not the key": {"Authorization", "Bearer " + hashKey(f.keys["a"])},
		"a key in X-API-Key, bad": {"X-API-Key", "ss_bad"},
	} {
		response, body := post(t, f.server.URL+"/mcp", header...)
		if response.StatusCode != http.StatusUnauthorized || !strings.Contains(response.Header.Get("WWW-Authenticate"), "resource_metadata=") {
			t.Fatalf("%s: %d %s", name, response.StatusCode, body)
		}
	}
	if response, body := post(t, f.server.URL+"/mcp", "X-API-Key", f.keys["a"]); response.StatusCode != http.StatusOK {
		t.Fatalf("X-API-Key: %d %s", response.StatusCode, body)
	}
}

// A call blocked by a plan gate is refused with the REST envelope: 403,
// workspace_feature_not_entitled, and the feature and plans requireTenantAccess
// reports.
func TestEntitlementRefusalMatchesREST(t *testing.T) {
	f := newFixture(t)
	body, isError := f.call(f.session("free"), "listReleases", map[string]any{})
	refusedWith(t, "listReleases", body, isError, "workspace_feature_not_entitled")
	if body["status"] != float64(403) || body["feature"] != "workspace:use" || body["currentPlan"] != "free" ||
		body["requiredPlan"] != "pro" {
		t.Fatalf("free workspace: %v", body)
	}
	// A contract override that withholds the campaign workflow refuses the
	// campaign tools, and only them.
	f.exec(`UPDATE workspace_entitlement SET "featureOverrides"='{"campaign:workflow":false,"asset:create":false}' WHERE "organizationId"=$1`, f.orgs["a"])
	session := f.session("a")
	body, isError = f.call(session, "listCampaigns", map[string]any{})
	refusedWith(t, "listCampaigns", body, isError, "workspace_feature_not_entitled")
	if body["feature"] != "campaign:workflow" || body["currentPlan"] != "pro" {
		t.Fatalf("campaign override: %v", body)
	}
	body, isError = f.call(session, "createAssetUploadUrl", map[string]any{"bytes": 1, "contentType": "image/png", "fileName": "x.png"})
	refusedWith(t, "createAssetUploadUrl", body, isError, "workspace_feature_not_entitled")
	if body["feature"] != "asset:create" {
		t.Fatalf("asset override: %v", body)
	}
	if _, isError = f.call(session, "listReleases", map[string]any{}); isError {
		t.Fatal("an override for other features refused releases")
	}
}

// A key sees only the tools its scopes allow; agents never see a decision tool.
func TestScopesLimitTheToolList(t *testing.T) {
	f := newFixture(t)
	session := f.session("a-read")
	listed, err := session.ListTools(f.ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tool := range listed.Tools {
		names = append(names, tool.Name)
	}
	// The SDK lists tools by name.
	want := []string{"captureScreenshot", "createAssetDownloadUrl", "getCampaign", "listApprovals", "listCampaigns", "listReleases"}
	if !slices.Equal(names, want) {
		t.Fatalf("read-only key tools=%v", names)
	}
	if _, err := session.CallTool(f.ctx, &sdk.CallToolParams{Name: "createRelease", Arguments: map[string]any{"title": "x"}}); err == nil {
		t.Fatal("a read-only key called createRelease")
	}
}

// A mutation through MCP is audited in its transaction with the call's
// request ID and the key as the actor.
func TestMutationsAreAuditedWithTheRequestID(t *testing.T) {
	f := newFixture(t)
	requestID := "mcp-audit-" + f.id
	session := f.session("a", "X-Request-Id", requestID)
	body, isError := f.call(session, "createCampaign", map[string]any{"name": "Audited", "objective": "Adoption"})
	if isError {
		t.Fatalf("createCampaign: %v", body)
	}
	id := body["campaign"].(map[string]any)["id"].(string)
	row, err := f.db.Client.AuditLog.Query().Where(auditlog.OrganizationID(f.orgs["a"]), auditlog.EntityID(id),
		auditlog.Action("product.campaign_created")).Only(f.ctx)
	if err != nil || row.RequestID != requestID || row.ActorDisplay == nil || *row.ActorDisplay != f.keyNames["a"] {
		t.Fatalf("audit: %+v %v", row, err)
	}
}

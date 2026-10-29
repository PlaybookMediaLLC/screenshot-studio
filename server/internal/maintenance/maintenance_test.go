package maintenance

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type objects struct{ deleted, aborted []string }

func (o *objects) AbortUpload(_ context.Context, org, key, uploadID string) error {
	o.aborted = append(o.aborted, org+"/"+key+"#"+uploadID)
	return nil
}

func (o *objects) Delete(_ context.Context, org, key string) error {
	if !strings.HasPrefix(key, "org/"+org+"/") {
		return fmt.Errorf("wrong tenant")
	}
	o.deleted = append(o.deleted, key)
	return nil
}
func setup(t *testing.T) (*Store, *objects) {
	t.Helper()
	dsn := os.Getenv("MAINTENANCE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set MAINTENANCE_TEST_DATABASE_URL to an isolated migrated maintenance_test database")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Path != "/maintenance_test" {
		t.Fatal("maintenance integration tests require the maintenance_test database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	// This dedicated database is disposable. Never run against application data.
	exec(t, db, `TRUNCATE organization,"user" CASCADE`)
	for _, org := range []string{"a", "b"} {
		exec(t, db, `INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())`, org)
	}
	exec(t, db, `INSERT INTO "user"(id,name,email,"updatedAt") VALUES('user','Test','fixture@example.invalid',now())`)
	o := &objects{}
	return &Store{DB: db, RetentionDB: db, Objects: o}, o
}
func exec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), q, args...); err != nil {
		t.Fatalf("query failed: %v\n%s", err, q)
	}
}
func expect(t *testing.T, db *sql.DB, want any, q string, args ...any) {
	t.Helper()
	var got string
	if err := db.QueryRow(q, args...).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != fmt.Sprint(want) {
		t.Fatalf("got %s want %v: %s", got, want, q)
	}
}
func run(t *testing.T, s *Store, job string) int {
	t.Helper()
	n, err := s.Run(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
func asset(t *testing.T, s *Store, id, org, status string) {
	exec(t, s.DB, `INSERT INTO asset(id,"organizationId","objectKey","mediaType",bytes,status,"updatedAt") VALUES($1,$2,$3,'image/png',1,$4::"AssetStatus",now())`, id, org, "org/"+org+"/"+id, status)
}
func event(t *testing.T, s *Store, id, org, resource, kind string) {
	exec(t, s.DB, `INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey") VALUES($1,$2,$3,'asset',$4,'{}',$1)`, id, org, kind, resource)
}
func TestOutboxTenantClaimsDeadLettersAndPausedWorkspaces(t *testing.T) {
	s, o := setup(t)
	asset(t, s, "uploaded", "a", "UPLOADED")
	asset(t, s, "deleted", "b", "DELETED")
	asset(t, s, "paused", "b", "UPLOADED")
	exec(t, s.DB, `INSERT INTO workspace_deletion(id,"organizationId","requestedByUserId","scheduledFor","updatedAt") VALUES('deletion','b','user',now()+interval '14 days',now())`)
	event(t, s, "good", "a", "uploaded", "asset.uploaded")
	event(t, s, "wrong", "a", "paused", "asset.uploaded")
	event(t, s, "cleanup", "b", "deleted", "asset.deleted")
	event(t, s, "paused-event", "b", "paused", "asset.uploaded")
	event(t, s, "crashed", "a", "uploaded", "asset.uploaded")
	exec(t, s.DB, `UPDATE outbox_event SET attempts=8,"processingAt"=now()-interval '11 minutes' WHERE id='crashed'`)
	if n := run(t, s, "tenant-outbox"); n != 2 {
		t.Fatalf("completed %d", n)
	}
	expect(t, s.DB, 0, `SELECT attempts FROM outbox_event WHERE id='paused-event'`)
	expect(t, s.DB, "true", `SELECT "deliveredAt" IS NULL FROM outbox_event WHERE id='wrong'`)
	expect(t, s.DB, "true", `SELECT "deadLetteredAt" IS NOT NULL FROM outbox_event WHERE id='crashed'`)
	if len(o.deleted) != 1 || o.deleted[0] != "org/b/deleted" {
		t.Fatalf("deleted: %v", o.deleted)
	}
	for range 7 {
		run(t, s, "tenant-outbox")
	}
	expect(t, s.DB, "true", `SELECT "deadLetteredAt" IS NOT NULL FROM outbox_event WHERE id='wrong'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE action='product.outbox_dead_lettered' AND "entityId"='wrong'`)
}
func TestRetentionHonorsLegalHoldAndDefaultPolicy(t *testing.T) {
	s, _ := setup(t)
	exec(t, s.DB, `DO $$ BEGIN CREATE ROLE maintenance_retention_test LOGIN PASSWORD 'local-test-only'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
	exec(t, s.DB, `GRANT USAGE ON SCHEMA public TO maintenance_retention_test`)
	exec(t, s.DB, `GRANT SELECT ON organization,audit_retention_policy,audit_drain TO maintenance_retention_test`)
	exec(t, s.DB, `GRANT SELECT,INSERT,DELETE ON audit_log TO maintenance_retention_test`)
	exec(t, s.DB, `GRANT SELECT,INSERT ON audit_outbox,audit_drain_delivery TO maintenance_retention_test`)
	retentionURL, _ := url.Parse(os.Getenv("MAINTENANCE_TEST_DATABASE_URL"))
	retentionURL.User = url.UserPassword("maintenance_retention_test", "local-test-only")
	limited, err := sql.Open("pgx", retentionURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { limited.Close() })
	s.RetentionDB = limited
	exec(t, s.DB, `INSERT INTO audit_drain(id,"organizationId",name,endpoint,"encryptedSigningSecret","updatedAt") VALUES('retention-drain','a','test','https://example.invalid','unused',now())`)

	exec(t, s.DB, `INSERT INTO audit_retention_policy("organizationId","legalHold","updatedAt") VALUES('b',true,now())`)
	exec(t, s.DB, `INSERT INTO audit_log(id,"organizationId","requestId","actorType",action,"entityType","createdAt") VALUES('old-a','a','r','SERVICE','test','test',now()-interval '91 days'),('new-a','a','r','SERVICE','test','test',now()-interval '1 day'),('old-b','b','r','SERVICE','test','test',now()-interval '365 days')`)
	if n := run(t, s, "audit-retention"); n != 1 {
		t.Fatalf("deleted %d", n)
	}
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE id='old-b'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE id='new-a'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE action='product.audit_retention_purged'`)
	if n := run(t, s, "audit-retention"); n != 0 {
		t.Fatalf("repeated deletion %d", n)
	}
}
func TestAuditLogIsAppendOnly(t *testing.T) {
	s, _ := setup(t)
	exec(t, s.DB, `INSERT INTO audit_log(id,"organizationId","requestId","actorType",action,"entityType") VALUES('kept','a','r','SERVICE','test','test')`)
	for _, statement := range []string{`UPDATE audit_log SET action='rewritten' WHERE id='kept'`, `DELETE FROM audit_log WHERE id='kept'`} {
		if _, err := s.DB.ExecContext(context.Background(), statement); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Fatalf("%s: err=%v", statement, err)
		}
	}
	err := transaction(context.Background(), s.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(context.Background(), `SET LOCAL shots.audit_retention = 'on'`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(context.Background(), `UPDATE audit_log SET action='rewritten' WHERE id='kept'`); err == nil {
			t.Fatal("a retention transaction rewrote an audit row")
		}
		return nil
	})
	if err == nil {
		t.Fatal("the refused update did not abort the transaction")
	}
	err = transaction(context.Background(), s.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(context.Background(), `SET LOCAL shots.audit_retention = 'on'`); err != nil {
			return err
		}
		_, err := tx.ExecContext(context.Background(), `DELETE FROM audit_log WHERE id='kept'`)
		return err
	})
	if err != nil {
		t.Fatalf("retention delete: %v", err)
	}
	expect(t, s.DB, 0, `SELECT count(*) FROM audit_log WHERE id='kept'`)

	// Deleting a user may only clear "actorUserId"; nothing else may change.
	exec(t, s.DB, `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('actor','Actor','actor@example.test',false,now(),now())`)
	exec(t, s.DB, `INSERT INTO audit_log(id,"organizationId","requestId","actorType","actorUserId",action,"entityType") VALUES('by-user','a','r','USER','actor','test','test')`)
	if _, err := s.DB.ExecContext(context.Background(), `UPDATE audit_log SET "actorUserId"=NULL, action='rewritten' WHERE id='by-user'`); err == nil {
		t.Fatal("clearing the actor also rewrote the action")
	}
	exec(t, s.DB, `DELETE FROM "user" WHERE id='actor'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE id='by-user' AND "actorUserId" IS NULL AND action='test'`)
}
func TestWorkspaceCleanupKeepsAuditAndOtherTenants(t *testing.T) {
	s, o := setup(t)
	asset(t, s, "asset-a", "a", "UPLOADED")
	asset(t, s, "asset-b", "b", "UPLOADED")
	exec(t, s.DB, `INSERT INTO design(id,"organizationId",name,document,"updatedAt") VALUES('design-a','a','test','{}',now()),('design-b','b','test','{}',now())`)
	exec(t, s.DB, `INSERT INTO workspace_deletion(id,"organizationId","requestedByUserId","scheduledFor","updatedAt") VALUES('due','a','user',now()-interval '1 day',now()),('future','b','user',now()+interval '14 days',now())`)
	exec(t, s.DB, `INSERT INTO audit_log(id,"organizationId","requestId","actorType",action,"entityType") VALUES('evidence','a','r','SERVICE','test','test')`)
	for _, org := range []string{"a", "b"} {
		exec(t, s.DB, `INSERT INTO launch_run(id,"organizationId",kind) VALUES($1,$2,'agent')`, "run-"+org, org)
		exec(t, s.DB, `INSERT INTO launch_run_step(id,"organizationId","runId","index",kind,status) VALUES($1,$2,$3,0,'model','SUCCEEDED')`, "step-"+org, org, "run-"+org)
		exec(t, s.DB, `INSERT INTO conversation(id,"organizationId",title) VALUES($1,$2,'Launch')`, "conversation-"+org, org)
		exec(t, s.DB, `INSERT INTO conversation_message(id,"organizationId","conversationId",role,kind,content,"launchRunId") VALUES($1,$2,$3,'user','text','Market it',$4)`,
			"message-"+org, org, "conversation-"+org, "run-"+org)
		exec(t, s.DB, `INSERT INTO onboarding_run(id,"organizationId",url,"idempotencyKey","workflowId","deadlineAt") VALUES($1,$2,'https://acme.test','key',$3,now())`,
			"onboarding-"+org, org, "onboarding-"+org)
		exec(t, s.DB, `INSERT INTO page_knowledge(id,"organizationId","runId",url,"contentHash","fetchedAt") VALUES($1,$2,$3,'https://acme.test/pricing','hash',now())`,
			"page-"+org, org, "onboarding-"+org)
		exec(t, s.DB, `INSERT INTO ideal_customer_profile(id,"organizationId") VALUES($1,$2)`, "icp-"+org, org)
		exec(t, s.DB, `INSERT INTO enrichment_record(id,"organizationId",domain,provider,field,value,"fetchedAt","expiresAt") VALUES($1,$2,'acme.test','site','brand','{}',now(),now())`,
			"enrichment-"+org, org)
	}
	cancelled := &onboardingCancels{}
	s.Onboarding = cancelled
	if n := run(t, s, "workspace-cleanup"); n != 1 {
		t.Fatalf("purged %d", n)
	}
	if len(cancelled.organizations) != 1 || cancelled.organizations[0] != "a" {
		t.Fatalf("onboarding cancelled for %v", cancelled.organizations)
	}
	expect(t, s.DB, "PURGED", `SELECT status FROM workspace_deletion WHERE id='due'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE id='evidence'`)
	expect(t, s.DB, 0, `SELECT count(*) FROM design WHERE "organizationId"='a'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM design WHERE "organizationId"='b'`)
	for _, table := range []string{"launch_run", "launch_run_step", "conversation", "conversation_message", "onboarding_run", "page_knowledge", "ideal_customer_profile", "enrichment_record"} {
		expect(t, s.DB, 0, `SELECT count(*) FROM "`+table+`" WHERE "organizationId"='a'`)
		expect(t, s.DB, 1, `SELECT count(*) FROM "`+table+`" WHERE "organizationId"='b'`)
	}
	if len(o.deleted) != 1 || o.deleted[0] != "org/a/asset-a" {
		t.Fatalf("deleted: %v", o.deleted)
	}
}
func communication(t *testing.T, s *Store) {
	exec(t, s.DB, `INSERT INTO release(id,"organizationId",title,"benefitStatement","updatedAt") VALUES('r','a','Title','Benefit',now())`)
	exec(t, s.DB, `INSERT INTO release_document(id,"organizationId","releaseId",revision,"frontMatter","bodyMarkdown","updatedAt") VALUES('doc','a','r',1,'{}','<script>unsafe</script>',now())`)
	exec(t, s.DB, `INSERT INTO customer_communication(id,"organizationId","releaseDocumentId",channel,status,"scheduledFor","idempotencyKey","updatedAt") VALUES('comm','a','doc','EMAIL','SCHEDULED',now(),'test',now())`)
	for _, v := range [][3]string{{"one", "a", "one@example.invalid"}, {"two", "a", "two@example.invalid"}, {"foreign", "b", "foreign@example.invalid"}} {
		exec(t, s.DB, `INSERT INTO audience_subscriber(id,"organizationId",email,"updatedAt") VALUES($1,$2,$3,now())`, v[0], v[1], v[2])
	}
}
func TestCommunicationPartialRetryRespectsConsentAndTenant(t *testing.T) {
	s, _ := setup(t)
	communication(t, s)
	calls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			To      []string          `json:"to"`
			HTML    string            `json:"html"`
			Headers map[string]string `json:"headers"`
		}
		json.NewDecoder(r.Body).Decode(&payload)
		email := payload.To[0]
		calls[email]++
		if !strings.Contains(payload.Headers["List-Unsubscribe"], "/api/unsubscribe?token=") || strings.Contains(payload.HTML, "<script>") {
			t.Error("unsafe email or missing unsubscribe")
		}
		if r.Header.Get("Idempotency-Key") == "" {
			t.Error("missing idempotency key")
		}
		if email == "two@example.invalid" {
			w.WriteHeader(429)
			return
		}
		io.WriteString(w, `{"id":"provider-id"}`)
	}))
	defer server.Close()
	s.Mail = &Mailer{APIKey: "test", From: "test@example.invalid", BaseURL: "https://app.example", SigningSecret: "secret", Endpoint: server.URL}
	if n := run(t, s, "communications"); n != 1 {
		t.Fatalf("delivered %d", n)
	}
	expect(t, s.DB, "SCHEDULED", `SELECT status FROM customer_communication WHERE id='comm'`)
	exec(t, s.DB, `UPDATE audience_subscriber SET "unsubscribedAt"=now() WHERE id='two'`)
	run(t, s, "communications")
	expect(t, s.DB, "DELIVERED", `SELECT status FROM customer_communication WHERE id='comm'`)
	if calls["one@example.invalid"] != 1 || calls["two@example.invalid"] != 1 || calls["foreign@example.invalid"] != 0 {
		t.Fatalf("mail calls: %v", calls)
	}
}
func TestUnknownEmailOutcomeIsNotAutomaticallyRetried(t *testing.T) {
	s, _ := setup(t)
	communication(t, s)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(503) }))
	defer server.Close()
	s.Mail = &Mailer{APIKey: "test", From: "test@example.invalid", BaseURL: "https://app.example", SigningSecret: "secret", Endpoint: server.URL}
	run(t, s, "communications")
	run(t, s, "communications")
	expect(t, s.DB, "FAILED", `SELECT status FROM customer_communication WHERE id='comm'`)
	expect(t, s.DB, "UNKNOWN_DELIVERY", `SELECT "failureCode" FROM communication_attempt WHERE "customerCommunicationId"='comm'`)
	if calls != 1 {
		t.Fatalf("ambiguous send retried: %d", calls)
	}
}

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func encrypted(key []byte, secret string) string {
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, 12)
	sealed := gcm.Seal(nil, nonce, []byte(secret), nil)
	tag := sealed[len(sealed)-16:]
	ciphertext := sealed[:len(sealed)-16]
	return base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(tag) + "." + base64.RawURLEncoding.EncodeToString(ciphertext)
}
func TestAuditDrainsWireFormatAndRetryCeiling(t *testing.T) {
	s, _ := setup(t)
	key := bytes.Repeat([]byte{1}, 32)
	secret := encrypted(key, "drain-secret")
	calls := 0
	exec(t, s.DB, `INSERT INTO audit_drain(id,"organizationId",name,endpoint,"encryptedSigningSecret","updatedAt") VALUES('drain','a','test','https://logs.example/ingest',$1,now())`, secret)
	if err := transaction(context.Background(), s.DB, func(tx *sql.Tx) error {
		return audit(context.Background(), tx, "a", "test", "test", "entity", "SUCCEEDED", nil)
	}); err != nil {
		t.Fatal(err)
	}
	s.Drains = &DrainSender{Key: key, HTTP: &http.Client{Transport: roundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("x-shots-signature") == "" {
			t.Error("missing signature")
		}
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if payload["specversion"] != "1.0" {
			t.Error("wrong CloudEvents format")
		}
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})}}
	for range 9 {
		// timestamp(3) rounds now() up to half a millisecond into the future.
		exec(t, s.DB, `UPDATE audit_drain_delivery SET "nextAttemptAt"=now()-interval '1 second'`)
		run(t, s, "audit-drains")
	}
	if calls != 8 {
		t.Fatalf("attempt count %d", calls)
	}
	expect(t, s.DB, "FAILED", `SELECT status FROM audit_drain_delivery`)
}
func TestUnsubscribeAndSecretCompatibility(t *testing.T) {
	// Produced independently with Node crypto, matching lib/tenant/unsubscribe-token.ts.
	want := "YTp0ZXN0QGV4YW1wbGUuY29t.XXJ-mSztt2m5K8iEGtD32ZCNf6m5fxoVq4gGk1cy3Fk"

	token := unsubscribeToken("a", "test@example.com", "secret")
	if token != want {
		t.Fatalf("incompatible unsubscribe token: %s", token)
	}
	key := bytes.Repeat([]byte{1}, 32)
	wire := "AAAAAAAAAAAAAAAA.j--kku_fCDphvBshA5qzzw.20f5tRsWcNrwC_cx"
	if secret, err := decryptSecret(key, wire); err != nil || secret != "drain-secret" {
		t.Fatalf("decrypt %q %v", secret, err)
	}
	if _, err := decryptSecret(key, "AA.AA.AA"); err == nil {
		t.Fatal("short nonce accepted")
	}
}
func TestDrainRejectsPrivateAddresses(t *testing.T) {
	sender := NewDrainSender(bytes.Repeat([]byte{1}, 32))
	for _, endpoint := range []string{"http://example.com", "https://127.0.0.1", "https://169.254.169.254", "https://[::1]"} {
		if _, err := sender.send(context.Background(), endpoint, "GENERIC", encrypted(sender.Key, "secret"), []byte(`{}`)); err == nil {
			t.Fatalf("allowed %s", endpoint)
		}
	}
}

type blockingObjects struct{ started, release chan struct{} }

func (o *blockingObjects) Delete(ctx context.Context, org, key string) error {
	close(o.started)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-o.release:
		return nil
	}
}
func TestConcurrentWorkersDoNotDuplicateOutboxSideEffects(t *testing.T) {
	s, _ := setup(t)
	asset(t, s, "deleted", "a", "DELETED")
	event(t, s, "cleanup", "a", "deleted", "asset.deleted")
	object := &blockingObjects{started: make(chan struct{}), release: make(chan struct{})}
	s.Objects = object
	result := make(chan error, 1)
	go func() { _, err := s.Run(context.Background(), "tenant-outbox"); result <- err }()
	<-object.started
	if n, err := s.Run(context.Background(), "tenant-outbox"); err != nil || n != 0 {
		t.Fatalf("overlapping run: count=%d error=%v", n, err)
	}
	close(object.release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE action='product.outbox_dispatched'`)
}
func TestStaleCommunicationsRequireReviewOnlyAfterAttempt(t *testing.T) {
	s, _ := setup(t)
	communication(t, s)
	exec(t, s.DB, `UPDATE customer_communication SET status='PROCESSING',"updatedAt"=now()-interval '16 minutes' WHERE id='comm'`)
	if err := s.recoverCommunications(context.Background()); err != nil {
		t.Fatal(err)
	}
	expect(t, s.DB, "SCHEDULED", `SELECT status FROM customer_communication WHERE id='comm'`)
	exec(t, s.DB, `UPDATE customer_communication SET status='PROCESSING',"updatedAt"=now()-interval '16 minutes' WHERE id='comm'`)
	exec(t, s.DB, `INSERT INTO communication_attempt(id,"organizationId","customerCommunicationId","attemptNumber") VALUES('attempt','a','comm',1)`)
	if err := s.recoverCommunications(context.Background()); err != nil {
		t.Fatal(err)
	}
	expect(t, s.DB, "FAILED", `SELECT status FROM customer_communication WHERE id='comm'`)
	expect(t, s.DB, "UNKNOWN_DELIVERY", `SELECT "failureCode" FROM communication_attempt WHERE id='attempt'`)
}

type onboardingCancels struct{ organizations []string }

func (o *onboardingCancels) Cancel(_ context.Context, organizationID string) error {
	o.organizations = append(o.organizations, organizationID)
	return nil
}

// Abandoned uploads and derivatives nothing used for 30 days are retired
// through the asset.deleted outbox; media a draft, a queued post or a batch
// still needs, and derivatives a published post shows, stay.
func TestAssetCleanupRetiresOnlyUnneededMedia(t *testing.T) {
	s, o := setup(t)
	ctx := context.Background()
	exec(t, s.DB, `INSERT INTO channel_connection (id,"organizationId",provider,"externalAccountId","secretReference","createdByUserId","updatedAt") VALUES ('conn','a','social','ext','KEY','user',now())`)
	exec(t, s.DB, `INSERT INTO content_draft (id,"organizationId",title,body,"plainText","assetIds","channelConnectionIds") VALUES ('draft','a','Draft','[]','','[]','[]')`)
	asset := func(id, status, key, age string) {
		exec(t, s.DB, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,'a',$2,'image/png',10,$3::"AssetStatus",now()-$4::interval,now()-$4::interval)`, id, key, status, age)
	}
	post := func(id, status, assetID string) {
		exec(t, s.DB, `INSERT INTO scheduled_post (id,"organizationId","channelConnectionId","contentDraftId","scheduledFor",status,caption,"idempotencyKey","assetIds","updatedAt") VALUES ($1,'a','conn','draft',now(),$2::"ScheduledPostStatus",'c',$1,jsonb_build_array($3::text),now())`, id, status, assetID)
	}
	derived := "org/a/derived/provider-images/"
	asset("stale-pending", "PENDING", "org/a/input/stale-pending/1/a.png", "25 hours")
	asset("fresh-pending", "PENDING", "org/a/input/fresh-pending/1/a.png", "1 hour")
	asset("old-failed", "FAILED", "org/a/input/old-failed/1/a.png", "2 hours")
	// A large upload abandoned partway: its parts are discarded with it.
	exec(t, s.DB, `UPDATE asset SET "uploadId"='upload-1' WHERE id='stale-pending'`)
	asset("original", "UPLOADED", "org/a/input/original/1/a.png", "90 days")
	asset("unused-copy", "UPLOADED", derived+"unused/1/x.png", "31 days")
	asset("queued-copy", "UPLOADED", derived+"queued/1/x.png", "31 days")
	asset("published-copy", "UPLOADED", derived+"published/1/x.png", "31 days")
	asset("cancelled-copy", "UPLOADED", derived+"cancelled/1/x.png", "31 days")
	asset("batch-copy", "UPLOADED", derived+"batch/1/x.png", "31 days")
	post("p1", "SCHEDULED", "queued-copy")
	post("p2", "PUBLISHED", "published-copy")
	post("p3", "CANCELLED", "cancelled-copy")
	exec(t, s.DB, `INSERT INTO social_set (id,"organizationId",name,"publicSlug") VALUES ('set','a','Set','set-a')`)
	exec(t, s.DB, `INSERT INTO content_batch (id,"organizationId","socialSetId",title) VALUES ('batch','a','set','Batch')`)
	exec(t, s.DB, `INSERT INTO content_batch_item (id,"batchId","organizationId","importKey",fingerprint,position,media) VALUES ('item','batch','a','batch-item-import-key','f',0,'[{"assetId":"batch-copy"}]')`)
	if n, err := s.Run(ctx, "asset-cleanup"); err != nil || n != 4 {
		t.Fatalf("cleaned %d err=%v", n, err)
	}
	if n, err := s.Run(ctx, "asset-cleanup"); err != nil || n != 0 {
		t.Fatalf("second run cleaned %d err=%v", n, err)
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id FROM asset WHERE "organizationId"='a' AND status='DELETED' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	var deleted []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		deleted = append(deleted, id)
	}
	rows.Close()
	if strings.Join(deleted, ",") != "cancelled-copy,old-failed,stale-pending,unused-copy" {
		t.Fatalf("deleted %v", deleted)
	}
	if _, err := s.Run(ctx, "tenant-outbox"); err != nil {
		t.Fatal(err)
	}
	if len(o.deleted) != 4 {
		t.Fatalf("objects deleted: %v", o.deleted)
	}
	if strings.Join(o.aborted, ",") != "a/org/a/input/stale-pending/1/a.png#upload-1" {
		t.Fatalf("uploads aborted: %v", o.aborted)
	}
}

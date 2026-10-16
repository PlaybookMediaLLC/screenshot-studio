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

type objects struct{ deleted []string }

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
	if n := run(t, s, "workspace-cleanup"); n != 1 {
		t.Fatalf("purged %d", n)
	}
	expect(t, s.DB, "PURGED", `SELECT status FROM workspace_deletion WHERE id='due'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM audit_log WHERE id='evidence'`)
	expect(t, s.DB, 0, `SELECT count(*) FROM design WHERE "organizationId"='a'`)
	expect(t, s.DB, 1, `SELECT count(*) FROM design WHERE "organizationId"='b'`)
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

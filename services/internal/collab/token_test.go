package collab

import (
	"strings"
	"testing"
	"time"
)

func TestTokensAreScopedSignedAndShortLived(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	now := time.Unix(1_800_000_000, 0)
	claims := Claims{Access: AccessWrite, DraftID: "d1", ExpiresAt: now.Add(TokenTTL).Unix(), OrganizationID: "o1", UserID: "u1"}
	token, err := Sign(key, claims)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := Verify(key, token, now, 0); err != nil || got != claims {
		t.Fatalf("verify=%+v err=%v", got, err)
	}
	if _, err := Verify(key, token, now.Add(TokenTTL), 0); err != ErrInvalidToken {
		t.Fatalf("expired token admitted a connection: %v", err)
	}
	if _, err := Verify(key, token, now.Add(TokenTTL+time.Hour), StoreGrace); err != nil {
		t.Fatalf("an admitted connection lost store access within the grace: %v", err)
	}
	if _, err := Verify([]byte(strings.Repeat("x", 32)), token, now, 0); err != ErrInvalidToken {
		t.Fatalf("token verified with another key: %v", err)
	}
	body, signature, _ := strings.Cut(token, ".")
	forged, _ := Sign(key, Claims{Access: AccessWrite, DraftID: "d2", ExpiresAt: claims.ExpiresAt, OrganizationID: "o1", UserID: "u1"})
	forgedBody, _, _ := strings.Cut(forged, ".")
	if _, err := Verify(key, forgedBody+"."+signature, now, 0); err != ErrInvalidToken {
		t.Fatalf("a token for one draft opened another: %v", err)
	}
	if _, err := Verify(key, body, now, 0); err != ErrInvalidToken {
		t.Fatalf("unsigned token accepted: %v", err)
	}
	if _, err := Sign([]byte("short"), claims); err == nil {
		t.Fatal("short key accepted")
	}
	if DocumentName("d1") != "content-draft:d1" {
		t.Fatal("document name changed")
	}
}

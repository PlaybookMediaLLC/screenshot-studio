package product

import (
	"strings"
	"testing"
	"time"
)

// The web verifies this exact vector in test/workflow-contracts.test.ts, so
// the Go signer and the TypeScript verifier cannot drift apart.
func TestWorkflowRenderSignatureMatchesTheWebVerifier(t *testing.T) {
	got := SignWorkflowRender([]byte(strings.Repeat("k", 40)), []byte(`{"organizationId":"org"}`), time.Unix(1792454400, 0))
	if want := "t=1792454400,v1=8e82175971c0945959d8004b2d126c6b4631ba7f718daaf2e9a1126ce8d64d76"; got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

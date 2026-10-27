package authstore

import (
	"errors"
	"strings"
	"testing"
)

func TestSCIMRequiresOrganizationOnCreationAndUpdate(t *testing.T) {
	for _, data := range []map[string]any{nil, {}, {"organizationId": nil}, {"organizationId": ""}, {"organizationId": " "}} {
		if _, err := scopeSCIMRequest(Request{Model: "scimProvider", Op: "create", Data: data}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("unscoped provider creation allowed: %v", err)
		}
	}
	if _, err := scopeSCIMRequest(Request{Model: "scimProvider", Op: "update", Data: map[string]any{"organizationId": nil}}); !errors.Is(err, ErrInvalid) {
		t.Fatal("an organization-bound provider could be made unowned")
	}
	if _, err := scopeSCIMRequest(Request{Model: "scimProvider", Op: "create", Data: map[string]any{"organizationId": "org_1"}}); err != nil {
		t.Fatal(err)
	}
}

func TestSCIMLegacyUnownedRowsCannotEscapeThroughORFilters(t *testing.T) {
	for _, op := range []string{"findOne", "findMany", "count", "update", "updateMany", "delete", "deleteMany", "consumeOne", "incrementOne"} {
		request, err := scopeSCIMRequest(Request{Model: "scimProvider", Op: op, Where: []Where{
			{Field: "providerId", Value: "legacy", Connector: "OR"},
			{Field: "organizationId", Value: nil, Connector: "OR"},
		}})
		if err != nil {
			t.Fatal(err)
		}
		q := &query{columns: map[string]string{"organizationId": "text", "providerId": "text"}}
		filter, err := q.filter(request.Where)
		if err != nil || !strings.HasPrefix(filter, `"organizationId" IS NOT NULL AND "organizationId" <> $2 AND (`) {
			t.Fatalf("%s did not enforce an organization independently of OR: %s %v", op, filter, err)
		}
	}
}

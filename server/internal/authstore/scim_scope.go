package authstore

import (
	"fmt"
	"strings"
)

// scopeSCIMRequest excludes legacy personal/unowned SCIM providers at the data
// boundary. Shots supports organization provisioning only. This also blocks
// access to historical unowned providers affected by GHSA-j8v8-g9cx-5qf4,
// even if a plugin endpoint omits its ownership check.
func scopeSCIMRequest(request Request) (Request, error) {
	if request.Model != "scimProvider" {
		return request, nil
	}
	organization, supplied := request.Data["organizationId"]
	if supplied || request.Op == "create" {
		id, ok := organization.(string)
		if !ok || strings.TrimSpace(id) == "" {
			return Request{}, fmt.Errorf("%w: SCIM providers require an organization", ErrInvalid)
		}
	}
	request.Where = append(append([]Where{}, request.Where...),
		Where{Field: "organizationId", Operator: "ne", Value: nil},
		Where{Field: "organizationId", Operator: "ne", Value: ""},
	)
	return request, nil
}

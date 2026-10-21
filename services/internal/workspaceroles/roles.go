// Package workspaceroles defines the additive collaboration role contract.
package workspaceroles

import "slices"

// WriterPublisher combines writing and publishing, without approval or admin rights.
const WriterPublisher = "writer_publisher"

// Allows matches a role against an operation's existing role allowlist.
// WriterPublisher has the union of Creator and Publisher capabilities; it never
// inherits Approver, Admin or Owner. Existing role meanings remain unchanged.
func Allows(role string, allowed ...string) bool {
	return slices.Contains(allowed, role) || role == WriterPublisher &&
		(slices.Contains(allowed, "creator") || slices.Contains(allowed, "publisher"))
}

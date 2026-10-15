package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// The API maps the sentinel to a status and returns the message verbatim, so
// both must survive wrapping.
func TestUserErrorsKeepStatusAndMessage(t *testing.T) {
	for _, check := range []struct {
		err  error
		kind error
	}{
		{conflict("This email already has a pending invitation."), publishing.ErrConflict},
		{notFound("Member not found."), publishing.ErrNotFound},
		{forbidden("Only the workspace owner can transfer ownership."), publishing.ErrForbidden},
		{invalid("Choose another workspace member."), ErrInvalidInput},
	} {
		if !errors.Is(check.err, check.kind) {
			t.Errorf("%q does not unwrap to %v", check.err, check.kind)
		}
		if check.err.Error() == check.kind.Error() {
			t.Errorf("%q lost its user-facing message", check.err)
		}
	}
}

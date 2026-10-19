package notifications

import (
	"os"
	"testing"
	"time"
)

// pgx writes a time.Time into the original app's "timestamp without time zone" columns
// as its wall clock and reads it back as UTC, so the process must run in UTC
// (as the original app does). Pin it so the tests do not depend on the machine's TZ.
func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}

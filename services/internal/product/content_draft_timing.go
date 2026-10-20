package product

import (
	"context"
	"sort"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
)

// Scheduling times (RFC 042). A schedule names a local wall time in a time
// zone; Go resolves it, refusing a time the clocks skip and asking which of
// two instants a repeated time means. The queue's next slot is reserved
// under a per-workspace lock, so two requests never take one slot.

// LocalTimeError explains a local time that names no instant or two.
type LocalTimeError struct {
	// Kind is gap (the clocks skip it) or ambiguous (they repeat it).
	Kind    string
	Earlier time.Time
	Later   time.Time
}

func (e *LocalTimeError) Error() string {
	if e.Kind == "gap" {
		return "That time does not exist in this time zone: the clocks skip it. Pick another time."
	}
	return "That time happens twice in this time zone: the clocks repeat it. Choose the earlier or the later one."
}

func (e *LocalTimeError) Unwrap() error { return ErrInvalidInput }

// resolveLocalTime turns a local time (YYYY-MM-DDTHH:MM) in a zone into the
// instant it names. Offsets around the time are tried; each that maps back
// to the same wall time is an instant it names. Disambiguation picks one of
// two: earlier or later; anything else refuses.
func resolveLocalTime(local, zoneName, disambiguation string) (time.Time, error) {
	zone, err := time.LoadLocation(zoneName)
	if zoneName == "" || err != nil {
		return time.Time{}, invalid("Schedule in an IANA time zone, such as Europe/Paris.")
	}
	naive, err := time.Parse("2006-01-02T15:04", local)
	if err != nil {
		return time.Time{}, invalid("Give the local time as YYYY-MM-DDTHH:MM.")
	}
	offsets := map[int]bool{}
	for _, hours := range []int{-36, -24, -12, 0, 12, 24, 36} {
		_, offset := naive.Add(time.Duration(hours) * time.Hour).In(zone).Zone()
		offsets[offset] = true
	}
	var instants []time.Time
	for offset := range offsets {
		at := naive.Add(-time.Duration(offset) * time.Second).UTC()
		if at.In(zone).Format("2006-01-02T15:04") == local && !containsTime(instants, at) {
			instants = append(instants, at)
		}
	}
	sort.Slice(instants, func(i, j int) bool { return instants[i].Before(instants[j]) })
	switch {
	case len(instants) == 0:
		return time.Time{}, &LocalTimeError{Kind: "gap"}
	case len(instants) == 1:
		return instants[0], nil
	case disambiguation == "earlier":
		return instants[0], nil
	case disambiguation == "later":
		return instants[len(instants)-1], nil
	}
	return time.Time{}, &LocalTimeError{Kind: "ambiguous", Earlier: instants[0], Later: instants[len(instants)-1]}
}

func containsTime(times []time.Time, at time.Time) bool {
	for _, t := range times {
		if t.Equal(at) {
			return true
		}
	}
	return false
}

// naturalOffset is a stable shift of −4 to +4 minutes from a key (the draft
// and its version), so a retry or a reload never moves the post. It is
// 32-bit FNV-1a over the key's code points, as the web computes it
// (naturalOffsetMinutes in lib/write/zoned-time.ts).
func naturalOffset(key string) time.Duration {
	var hash uint32 = 2_166_136_261
	for _, character := range key {
		hash ^= uint32(character)
		hash *= 16_777_619
	}
	return time.Duration(int(hash%9)-4) * time.Minute
}

// lockDraftQueue serializes queue reservations of one workspace for the
// rest of the transaction.
func lockDraftQueue(ctx context.Context, tx *ent.Tx, organizationID string) error {
	_, err := tx.PlatformExec(ctx, `SELECT pg_advisory_xact_lock(hashtext('content-draft-queue:' || $1))`, organizationID)
	return err
}

// nextFreeSlot is the next weekly slot after now that none of the
// connections already posts at, read inside the locked transaction.
func (c *Configuration) nextFreeSlot(ctx context.Context, tx *ent.Tx, organizationID string, connectionIDs []string) (time.Time, error) {
	settings, err := c.draftSettings(ctx, organizationID)
	if err != nil {
		return time.Time{}, err
	}
	if len(settings.PostingSlots) == 0 {
		return time.Time{}, conflict("Add a posting slot to the queue first.")
	}
	zone, _ := c.workspaceZone(ctx, organizationID)
	candidates := slotTimes(settings.PostingSlots, zone, time.Now().Add(time.Minute), 200)
	if len(candidates) == 0 {
		return time.Time{}, conflict("The queue has no open slot in the next twelve weeks.")
	}
	taken, err := tx.ScheduledPost.Query().Where(scheduledpost.OrganizationID(organizationID),
		scheduledpost.ChannelConnectionIDIn(connectionIDs...),
		scheduledpost.StatusIn(scheduledpost.StatusSCHEDULED, scheduledpost.StatusPROCESSING),
		scheduledpost.ScheduledForGTE(candidates[0]), scheduledpost.ScheduledForLTE(candidates[len(candidates)-1].Add(5*time.Minute))).
		All(ctx)
	if err != nil {
		return time.Time{}, err
	}
	busy := map[int64]bool{}
	for _, post := range taken {
		// A natural offset moves a post up to four minutes; it still holds its slot.
		for _, at := range candidates {
			if delta := post.ScheduledFor.Sub(at); delta > -5*time.Minute && delta < 5*time.Minute {
				busy[at.Unix()] = true
			}
		}
	}
	for _, at := range candidates {
		if !busy[at.Unix()] {
			return at, nil
		}
	}
	return time.Time{}, conflict("Every queue slot in the next twelve weeks is taken.")
}

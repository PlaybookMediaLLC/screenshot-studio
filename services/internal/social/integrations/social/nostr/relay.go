package nostr

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/coder/websocket"
)

// nostr-tools timings, shortened by tests.
var (
	poolConnectTimeout = 3 * time.Second         // SimplePool maxWaitForConnection
	poolEoseTimeout    = 4400 * time.Millisecond // AbstractRelay baseEoseTimeout
	publishTimeout     = 4400 * time.Millisecond // AbstractRelay publishTimeout
)

type Event struct {
	Kind      int        `json:"kind"`
	Content   string     `json:"content"`
	Tags      [][]string `json:"tags"`
	CreatedAt int64      `json:"created_at"`
	PubKey    string     `json:"pubkey"`
	ID        string     `json:"id"`
	Sig       string     `json:"sig"`
}

// secretKey is `Uint8Array.from(password.match(/.{1,2}/g).map(b => parseInt(b, 16)))`
// followed by getPublicKey's key validation.
func secretKey(password string) (*btcec.PrivateKey, error) {
	var key []byte
	var chunk []rune
	flush := func() {
		if len(chunk) > 0 {
			key = append(key, parseHexPrefix(string(chunk)))
		}
		chunk = chunk[:0]
	}
	for _, r := range password {
		// `.` does not match line terminators: they split the chunks
		if r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029' {
			flush()
			continue
		}
		chunk = append(chunk, r)
		if len(chunk) == 2 {
			flush()
		}
	}
	flush()
	if len(key) != 32 {
		return nil, fmt.Errorf("private key must be 32 bytes, got %d", len(key))
	}
	var scalar btcec.ModNScalar
	if scalar.SetByteSlice(key) || scalar.IsZero() {
		return nil, errors.New("invalid private key")
	}
	priv, _ := btcec.PrivKeyFromBytes(key)
	return priv, nil
}

// parseHexPrefix is parseInt(s, 16) truncated to a byte; NaN becomes 0.
func parseHexPrefix(s string) byte {
	s = strings.TrimLeft(s, " \t")
	end := 0
	for end < len(s) && strings.IndexByte("0123456789abcdefABCDEF", s[end]) >= 0 {
		end++
	}
	n, _ := strconv.ParseUint(s[:end], 16, 8)
	return byte(n)
}

func publicKey(priv *btcec.PrivateKey) string {
	return hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey()))
}

// jsonString is JSON.stringify for a string, which NIP-01 ids are hashed
// over (Go's encoder escapes <, >, &, U+2028 and U+2029 differently).
func jsonString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// eventHash is getEventHash: sha256 of [0,pubkey,created_at,kind,tags,content].
func eventHash(e *Event) [32]byte {
	var b strings.Builder
	b.WriteString("[0,")
	jsonString(&b, e.PubKey)
	fmt.Fprintf(&b, ",%d,%d,[", e.CreatedAt, e.Kind)
	for i, tag := range e.Tags {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		for j, item := range tag {
			if j > 0 {
				b.WriteByte(',')
			}
			jsonString(&b, item)
		}
		b.WriteByte(']')
	}
	b.WriteString("],")
	jsonString(&b, e.Content)
	b.WriteByte(']')
	return sha256.Sum256([]byte(b.String()))
}

// finalizeEvent sets pubkey, id and a BIP-340 signature with random aux data.
func finalizeEvent(priv *btcec.PrivateKey, kind int, content string, tags [][]string, createdAt int64) (*Event, error) {
	e := &Event{Kind: kind, Content: content, Tags: tags, CreatedAt: createdAt, PubKey: publicKey(priv)}
	hash := eventHash(e)
	e.ID = hex.EncodeToString(hash[:])
	var aux [32]byte
	if _, err := rand.Read(aux[:]); err != nil {
		return nil, err
	}
	sig, err := schnorr.Sign(priv, hash[:], schnorr.CustomNonce(aux))
	if err != nil {
		return nil, err
	}
	e.Sig = hex.EncodeToString(sig.Serialize())
	return e, nil
}

// verifyEvent is nostr-tools' verifyEvent: the id matches the content and
// the signature matches the id.
func verifyEvent(e *Event) bool {
	hash := eventHash(e)
	if hex.EncodeToString(hash[:]) != e.ID {
		return false
	}
	pub, err := hex.DecodeString(e.PubKey)
	if err != nil {
		return false
	}
	key, err := schnorr.ParsePubKey(pub)
	if err != nil {
		return false
	}
	raw, err := hex.DecodeString(e.Sig)
	if err != nil {
		return false
	}
	sig, err := schnorr.ParseSignature(raw)
	return err == nil && sig.Verify(hash[:], key)
}

type filter struct {
	Kinds   []int    `json:"kinds"`
	Authors []string `json:"authors"`
	Limit   int      `json:"limit,omitempty"`
}

func (f filter) matches(e *Event) bool {
	return slices.Contains(f.Kinds, e.Kind) && slices.Contains(f.Authors, e.PubKey)
}

// relayConn is one relay websocket; messages are the relay's JSON arrays.
type relayConn struct {
	conn     *websocket.Conn
	messages chan []json.RawMessage
	done     chan struct{}
}

func dial(ctx context.Context, url string) (*relayConn, error) {
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(-1)
	r := &relayConn{conn: conn, messages: make(chan []json.RawMessage), done: make(chan struct{})}
	go func() {
		defer close(r.messages)
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var message []json.RawMessage
			if json.Unmarshal(data, &message) != nil || len(message) == 0 {
				continue
			}
			select {
			case r.messages <- message:
			case <-r.done:
				return
			}
		}
	}()
	return r, nil
}

func (r *relayConn) send(ctx context.Context, message ...any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return r.conn.Write(ctx, websocket.MessageText, data)
}

func (r *relayConn) close() {
	close(r.done)
	r.conn.CloseNow()
}

func messageType(m []json.RawMessage) string {
	var t string
	_ = json.Unmarshal(m[0], &t)
	return t
}

func messageString(m []json.RawMessage, i int) string {
	var s string
	if len(m) > i {
		_ = json.Unmarshal(m[i], &s)
	}
	return s
}

// subscriptionEvent returns the valid event an EVENT message carries for sub.
func subscriptionEvent(m []json.RawMessage, sub string, f filter) *Event {
	if len(m) < 3 || messageString(m, 1) != sub {
		return nil
	}
	var e Event
	if json.Unmarshal(m[2], &e) != nil || !f.matches(&e) || !verifyEvent(&e) {
		return nil
	}
	return &e
}

const subID = "sub:1"

// publishTo is relay.publish(): send the event and wait for the relay's
// NIP-01 `["OK", <id>, <accepted>, <message>]` for that id. A rejection
// returns the relay's message.
func publishTo(ctx context.Context, url string, event *Event) error {
	r, err := dial(ctx, url)
	if err != nil {
		return err
	}
	defer r.close()

	if err := r.send(ctx, "EVENT", event); err != nil {
		return err
	}
	deadline := time.NewTimer(publishTimeout)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return errors.New("publish timed out")
		case m, ok := <-r.messages:
			if !ok {
				return errors.New("relay connection closed")
			}
			if messageType(m) != "OK" || messageString(m, 1) != event.ID {
				continue
			}
			var accepted bool
			if len(m) > 2 {
				_ = json.Unmarshal(m[2], &accepted)
			}
			if !accepted {
				return errors.New(messageString(m, 3))
			}
			return nil
		}
	}
}

// poolGet is SimplePool.get: query every relay at once and return the newest
// matching event, or nil.
func poolGet(ctx context.Context, urls []string, f filter) *Event {
	var (
		mu     sync.Mutex
		events []*Event
		seen   = map[string]bool{}
		wg     sync.WaitGroup
	)
	for _, url := range urls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			dialCtx, cancel := context.WithTimeout(ctx, poolConnectTimeout)
			r, err := dial(dialCtx, url)
			cancel()
			if err != nil {
				return
			}
			defer r.close()
			if r.send(ctx, "REQ", subID, f) != nil {
				return
			}
			eose := time.NewTimer(poolEoseTimeout)
			defer eose.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-eose.C:
					return
				case m, ok := <-r.messages:
					if !ok {
						return
					}
					switch messageType(m) {
					case "EVENT":
						if e := subscriptionEvent(m, subID, f); e != nil {
							mu.Lock()
							if !seen[e.ID] {
								seen[e.ID] = true
								events = append(events, e)
							}
							mu.Unlock()
						}
					case "EOSE", "CLOSED":
						if messageString(m, 1) == subID {
							return
						}
					}
				}
			}
		}()
	}
	wg.Wait()
	slices.SortStableFunc(events, func(a, b *Event) int { return int(b.CreatedAt - a.CreatedAt) })
	if len(events) == 0 {
		return nil
	}
	return events[0]
}

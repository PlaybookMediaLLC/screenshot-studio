package ent

import (
	"bytes"
	"encoding/json"
	"time"
)

// JSTime is the format of JavaScript's Date.prototype.toJSON, which is how
// Prisma rows reach Postiz clients.
const JSTime = "2006-01-02T15:04:05.000Z"

type prismaJSON struct {
	buf bytes.Buffer
	err error
}

func newPrismaJSON() *prismaJSON {
	w := &prismaJSON{}
	w.buf.WriteByte('{')
	return w
}

func (w *prismaJSON) field(name string, value any) {
	if w.err != nil {
		return
	}
	switch v := value.(type) {
	case time.Time:
		value = v.UTC().Format(JSTime)
	case *time.Time:
		if v != nil {
			value = v.UTC().Format(JSTime)
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		w.err = err
		return
	}
	if w.buf.Len() > 1 {
		w.buf.WriteByte(',')
	}
	key, _ := json.Marshal(name)
	w.buf.Write(key)
	w.buf.WriteByte(':')
	w.buf.Write(encoded)
}

func (w *prismaJSON) bytes() ([]byte, error) {
	if w.err != nil {
		return nil, w.err
	}
	w.buf.WriteByte('}')
	return w.buf.Bytes(), nil
}

// prismaList renders an unloaded-but-empty to-many relation as [] like Prisma.
func prismaList[T any](list []T) []T {
	if list == nil {
		return []T{}
	}
	return list
}

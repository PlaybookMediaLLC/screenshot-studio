// Package mediavideo reads the facts scheduling checks from an MP4 or
// QuickTime upload: duration, display size and codecs. It reads the file once
// as a stream and keeps only the bounded moov box in memory.
package mediavideo

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"

	mp4 "github.com/abema/go-mp4"
)

// Info is what one upload holds. A zero DurationMs means the container does
// not state it (a fragmented file without mehd, for example).
type Info struct {
	DurationMs int
	// Width and Height are the display size, after the track's rotation.
	Width, Height int
	// Codecs are the sample entry types in track order, such as avc1 or mp4a.
	Codecs []string
}

// ErrInvalid is a file that is not a readable MP4 or QuickTime movie.
var ErrInvalid = errors.New("the video is not a complete MP4 or QuickTime movie")

// moovLimit bounds the metadata held in memory, whatever the file claims.
const moovLimit = 32 << 20

// Probe consumes r to its end, or to the first malformed box.
func Probe(r io.Reader) (Info, error) {
	var moov []byte
	data, typed := false, false
	header := make([]byte, 16)
	for boxes := 0; ; boxes++ {
		if boxes > 10000 {
			return Info{}, ErrInvalid
		}
		if _, err := io.ReadFull(r, header[:8]); err == io.EOF {
			break
		} else if err != nil {
			return Info{}, ErrInvalid
		}
		size, kind, headerSize := uint64(binary.BigEndian.Uint32(header[:4])), string(header[4:8]), uint64(8)
		if size == 1 {
			if _, err := io.ReadFull(r, header[8:16]); err != nil {
				return Info{}, ErrInvalid
			}
			size, headerSize = binary.BigEndian.Uint64(header[8:16]), 16
		}
		if boxes == 0 {
			// Both containers open with ftyp; older QuickTime files may open with a wide, free or mdat atom.
			typed = kind == "ftyp" || kind == "wide" || kind == "free" || kind == "mdat" || kind == "moov"
			if !typed {
				return Info{}, ErrInvalid
			}
		}
		if size == 0 {
			// The last box runs to the end of the file.
			data = data || kind == "mdat"
			if _, err := io.Copy(io.Discard, r); err != nil {
				return Info{}, ErrInvalid
			}
			break
		}
		if size < headerSize {
			return Info{}, ErrInvalid
		}
		body := size - headerSize
		switch kind {
		case "moov":
			if moov != nil || size > moovLimit {
				return Info{}, ErrInvalid
			}
			moov = make([]byte, size)
			copy(moov, header[:headerSize])
			if _, err := io.ReadFull(r, moov[headerSize:]); err != nil {
				return Info{}, ErrInvalid
			}
			continue
		case "mdat", "moof":
			data = data || body > 0
		}
		if n, err := io.CopyN(io.Discard, r, int64(body)); err != nil || n != int64(body) {
			return Info{}, ErrInvalid
		}
	}
	if moov == nil || !data {
		return Info{}, ErrInvalid
	}
	return readMovie(moov)
}

type track struct {
	handler       string
	width, height uint32
	matrix        [9]int32
	codecs        []string
}

func readMovie(moov []byte) (Info, error) {
	var (
		movie    *mp4.Mvhd
		fragment uint64
		tracks   []*track
		boxes    int
	)
	_, err := mp4.ReadBoxStructure(bytes.NewReader(moov), func(h *mp4.ReadHandle) (any, error) {
		boxes++
		if boxes > 10000 || len(h.Path) > 12 {
			return nil, ErrInvalid
		}
		path := make([]string, len(h.Path))
		for i, t := range h.Path {
			path[i] = t.String()
		}
		full := strings.Join(path, "/")
		var current *track
		if len(h.Params) > 0 {
			current, _ = h.Params[0].(*track)
		}
		switch full {
		case "moov", "moov/mvex":
			return h.Expand()
		case "moov/trak":
			if len(tracks) >= 16 {
				return nil, ErrInvalid
			}
			current = &track{}
			tracks = append(tracks, current)
			return h.Expand(current)
		case "moov/trak/mdia", "moov/trak/mdia/minf", "moov/trak/mdia/minf/stbl":
			return h.Expand(current)
		case "moov/trak/mdia/minf/stbl/stsd":
			return h.Expand(current)
		case "moov/mvhd", "moov/mvex/mehd", "moov/trak/tkhd", "moov/trak/mdia/hdlr":
			box, _, err := h.ReadPayload()
			if err != nil {
				return nil, ErrInvalid
			}
			switch b := box.(type) {
			case *mp4.Mvhd:
				movie = b
			case *mp4.Mehd:
				fragment = b.GetFragmentDuration()
			case *mp4.Tkhd:
				current.width, current.height, current.matrix = b.Width>>16, b.Height>>16, b.Matrix
			case *mp4.Hdlr:
				current.handler = string(b.HandlerType[:])
			}
			return nil, nil
		}
		if len(path) == 7 && path[5] == "stsd" && current != nil {
			current.codecs = append(current.codecs, strings.TrimSpace(path[6]))
		}
		return nil, nil
	})
	if err != nil || movie == nil || movie.Timescale == 0 {
		return Info{}, ErrInvalid
	}
	info := Info{}
	duration := movie.GetDuration()
	if duration == 0 {
		duration = fragment
	}
	if ms := duration * 1000 / uint64(movie.Timescale); ms < 1<<31 {
		info.DurationMs = int(ms)
	}
	for _, t := range tracks {
		info.Codecs = append(info.Codecs, t.codecs...)
		if t.handler != "vide" || info.Width != 0 {
			continue
		}
		info.Width, info.Height = int(t.width), int(t.height)
		// A quarter turn (b and c set, a and d zero) swaps the displayed sides.
		if t.matrix[0] == 0 && t.matrix[4] == 0 && t.matrix[1] != 0 && t.matrix[3] != 0 {
			info.Width, info.Height = info.Height, info.Width
		}
	}
	if info.Width == 0 || info.Height == 0 {
		return Info{}, ErrInvalid
	}
	return info, nil
}

package x

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"

	mp4 "github.com/abema/go-mp4"
)

// Metadata inspection never reads the mdat payload into memory. A read budget,
// file-bound seeks, context, box count and depth bound malformed containers.
type metadataReader struct {
	reader          *bytes.Reader
	ctx             context.Context
	size, remaining int64
}

func (r *metadataReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.remaining <= 0 {
		return 0, errors.New("MP4 metadata limit exceeded")
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.reader.Read(p)
	r.remaining -= int64(n)
	return n, err
}
func (r *metadataReader) Seek(offset int64, whence int) (int64, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if whence == io.SeekEnd {
		offset += r.size
	} else if whence == io.SeekCurrent {
		at, err := r.reader.Seek(0, io.SeekCurrent)
		if err != nil {
			return 0, err
		}
		offset += at
	}
	if offset < 0 || offset > r.size {
		return 0, errors.New("MP4 offset is outside the file")
	}
	return r.reader.Seek(offset, io.SeekStart)
}

type videoTrack struct {
	handler  string
	clock    *mp4.Mdhd
	samples  *mp4.Stts
	visual   *mp4.VisualSampleEntry
	audio    *mp4.AudioSampleEntry
	avc, aac bool
}

func inspectMP4(ctx context.Context, file *os.File, size int64) (int64, error) {
	invalid := func() (int64, error) {
		return 0, publishRejected("Choose a complete MP4 video with H.264 video, valid timing, and optional mono or stereo AAC-LC audio.")
	}
	// Parse top-level headers first. Only a bounded moov container enters the
	// generic box decoder, so an attacker-controlled descriptor length cannot
	// allocate according to the surrounding multi-gigabyte mdat size.
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return invalid()
	}
	var metadata []byte
	hasData := false
	for boxes := 0; ; boxes++ {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		if boxes > 10000 {
			return invalid()
		}
		info, err := mp4.ReadBoxInfo(file)
		if err == io.EOF {
			break
		}
		if err != nil || info.Size < info.HeaderSize || info.Offset > uint64(size) || info.Size > uint64(size)-info.Offset {
			return invalid()
		}
		switch info.Type.String() {
		case "moof":
			return 0, publishRejected("Fragmented MP4 timing is not yet supported by X validation. Export a regular MP4 before publishing.")
		case "mdat":
			hasData = hasData || info.Size > info.HeaderSize
		case "moov":
			if metadata != nil || info.Size > 32<<20 {
				return invalid()
			}
			metadata, err = io.ReadAll(io.NewSectionReader(file, int64(info.Offset), int64(info.Size)))
			if err != nil {
				return invalid()
			}
		}
		if _, err := info.SeekToEnd(file); err != nil {
			return invalid()
		}
	}
	if len(metadata) == 0 || !hasData {
		return invalid()
	}
	source := bytes.NewReader(metadata)
	size = int64(len(metadata))
	r := &metadataReader{reader: source, ctx: ctx, size: size, remaining: 32 << 20}
	var tracks []*videoTrack
	var movie *mp4.Mvhd
	boxes := 0
	_, err := mp4.ReadBoxStructure(r, func(h *mp4.ReadHandle) (any, error) {
		boxes++
		if boxes > 10000 || len(h.Path) > 10 || h.BoxInfo.Size < h.BoxInfo.HeaderSize || h.BoxInfo.Offset > uint64(size) || h.BoxInfo.Size > uint64(size)-h.BoxInfo.Offset {
			return nil, errors.New("invalid MP4 structure")
		}
		path := make([]string, len(h.Path))
		for i, t := range h.Path {
			path[i] = t.String()
		}
		full := strings.Join(path, "/")
		var track *videoTrack
		if len(h.Params) > 0 {
			track, _ = h.Params[0].(*videoTrack)
		}
		switch full {
		case "mdat":
			hasData = hasData || h.BoxInfo.Size > h.BoxInfo.HeaderSize
			return nil, nil
		case "moov":
			return h.Expand()
		case "moov/trak":
			if len(tracks) >= 16 {
				return nil, errors.New("too many MP4 tracks")
			}
			track = &videoTrack{}
			tracks = append(tracks, track)
			return h.Expand(track)
		case "moov/trak/mdia", "moov/trak/mdia/minf", "moov/trak/mdia/minf/stbl":
			return h.Expand(track)
		}
		if h.BoxInfo.Size > 4<<20 {
			return nil, nil
		}
		switch full {
		case "moov/mvhd", "moov/trak/mdia/mdhd", "moov/trak/mdia/hdlr", "moov/trak/mdia/minf/stbl/stts", "moov/trak/mdia/minf/stbl/stsd", "moov/trak/mdia/minf/stbl/stsd/avc1", "moov/trak/mdia/minf/stbl/stsd/avc1/avcC", "moov/trak/mdia/minf/stbl/stsd/mp4a", "moov/trak/mdia/minf/stbl/stsd/mp4a/esds":
			if r.remaining < int64(h.BoxInfo.Size) {
				return nil, errors.New("MP4 metadata limit exceeded")
			}
			r.remaining -= int64(h.BoxInfo.Size)
			var box mp4.IBox
			var e error
			if full == "moov/trak/mdia/minf/stbl/stsd" || full == "moov/trak/mdia/minf/stbl/stsd/avc1" || full == "moov/trak/mdia/minf/stbl/stsd/mp4a" {
				box, _, e = h.ReadPayload()
			} else {
				// Dynamic descriptor lengths must be bounded to this box,
				// never to the multi-gigabyte media file that surrounds it.
				bodySize := h.BoxInfo.Size - h.BoxInfo.HeaderSize
				section := io.NewSectionReader(source, int64(h.BoxInfo.Offset+h.BoxInfo.HeaderSize), int64(bodySize))
				box, _, e = mp4.UnmarshalAny(section, h.BoxInfo.Type, bodySize, h.BoxInfo.Context)
			}
			if e != nil {
				return nil, e
			}
			switch b := box.(type) {
			case *mp4.Mvhd:
				if movie != nil {
					return nil, errors.New("duplicate movie timing")
				}
				movie = b
			case *mp4.Mdhd:
				if track.clock != nil {
					return nil, errors.New("duplicate track timing")
				}
				track.clock = b
			case *mp4.Hdlr:
				track.handler = string(b.HandlerType[:])
			case *mp4.Stts:
				track.samples = b
			case *mp4.Stsd:
				if b.EntryCount != 1 {
					return nil, errors.New("unsupported sample descriptions")
				}
				return h.Expand(track)
			case *mp4.VisualSampleEntry:
				track.visual = b
				return h.Expand(track)
			case *mp4.AudioSampleEntry:
				track.audio = b
				return h.Expand(track)
			case *mp4.AVCDecoderConfiguration:
				track.avc = b.ConfigurationVersion == 1 && len(b.SequenceParameterSets) > 0 && len(b.PictureParameterSets) > 0
			case *mp4.Esds:
				object, profile := false, false
				for _, d := range b.Descriptors {
					if d.DecoderConfigDescriptor != nil {
						object = d.DecoderConfigDescriptor.ObjectTypeIndication == 0x40
					}
					if d.Tag == mp4.DecSpecificInfoTag && len(d.Data) >= 2 {
						profile = d.Data[0]>>3 == 2
					}
				}
				track.aac = object && profile
			}
		}
		return nil, nil
	})
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	if err != nil || movie == nil || !hasData || len(tracks) == 0 {
		return invalid()
	}
	duration := func(units uint64, scale uint32) (int64, bool) {
		if scale == 0 || units == 0 || units/uint64(scale) > 24*60*60 {
			return 0, false
		}
		return int64(units/uint64(scale))*1000 + int64((units%uint64(scale)*1000+uint64(scale)-1)/uint64(scale)), true
	}
	maxDuration, ok := duration(movie.GetDuration(), movie.Timescale)
	if !ok {
		return invalid()
	}
	videos := 0
	for _, t := range tracks {
		if t.handler != "vide" && t.handler != "soun" {
			continue
		}
		if t.clock == nil || t.samples == nil || len(t.samples.Entries) == 0 {
			return invalid()
		}
		ms, ok := duration(t.clock.GetDuration(), t.clock.Timescale)
		if !ok {
			return invalid()
		}
		maxDuration = max(maxDuration, ms)
		var units uint64
		for _, sample := range t.samples.Entries {
			if sample.SampleCount == 0 || sample.SampleDelta == 0 {
				return invalid()
			}
			if t.handler == "vide" && uint64(sample.SampleDelta)*60 < uint64(t.clock.Timescale) {
				return 0, publishRejected("X video frame rates must not exceed 60 FPS.")
			}
			add := uint64(sample.SampleCount) * uint64(sample.SampleDelta)
			if add > uint64(t.clock.Timescale)*24*60*60 || units > uint64(t.clock.Timescale)*24*60*60-add {
				return invalid()
			}
			units += add
		}
		ms, ok = duration(units, t.clock.Timescale)
		if !ok {
			return invalid()
		}
		maxDuration = max(maxDuration, ms)
		if t.handler == "vide" {
			videos++
			if t.clock.GetDuration()*2 < uint64(t.clock.Timescale) || units*2 < uint64(t.clock.Timescale) {
				return 0, publishRejected("X videos must be at least 0.5 seconds long.")
			}
			if t.visual == nil || !t.avc || t.visual.Width < 32 || t.visual.Height < 32 {
				return invalid()
			}
			if uint32(t.visual.Width) > 3*uint32(t.visual.Height) || uint32(t.visual.Height) > 3*uint32(t.visual.Width) {
				return 0, publishRejected("X video aspect ratios must be between 1:3 and 3:1.")
			}
		} else if t.audio == nil || !t.aac || t.audio.ChannelCount < 1 || t.audio.ChannelCount > 2 {
			return invalid()
		}
	}
	if videos != 1 {
		return invalid()
	}
	return maxDuration, nil
}

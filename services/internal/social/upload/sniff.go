package upload

import "bytes"

// SniffSize is how many leading bytes the file-type package reads.
const SniffSize = 4100

// FileType is what the file-type npm package reports: the real type read
// from the leading bytes, never the claimed one.
type FileType struct {
	Mime string
	Ext  string
}

// DetectFileType is fileTypeFromBuffer for the formats Postiz accepts
// anywhere (the storage, upload and multipart allow-lists, plus QuickTime).
// Every other format reports nil, which every caller rejects the same way.
func DetectFileType(b []byte) *FileType {
	has := func(off int, sig string) bool {
		return len(b) >= off+len(sig) && string(b[off:off+len(sig)]) == sig
	}
	switch {
	case has(0, "\xFF\xD8\xFF"):
		return &FileType{"image/jpeg", "jpg"}
	case has(0, "\x89PNG\r\n\x1A\n"):
		return &FileType{"image/png", "png"}
	case has(0, "GIF"):
		return &FileType{"image/gif", "gif"}
	case has(0, "RIFF") && has(8, "WEBP"):
		return &FileType{"image/webp", "webp"}
	case has(0, "RIFF") && has(8, "WAVE"):
		return &FileType{"audio/wav", "wav"}
	case has(0, "BM"):
		return &FileType{"image/bmp", "bmp"}
	case has(0, "II*\x00") || has(0, "MM\x00*"):
		// ponytail: TIFF-based camera raws (cr2, nef, arw, dng) also land here;
		// file-type tells them apart by walking the IFD.
		return &FileType{"image/tiff", "tif"}
	case has(0, "ID3"):
		return &FileType{"audio/mpeg", "mp3"}
	case has(0, "OggS"):
		return oggType(b)
	case has(4, "ftyp") && len(b) > 8 && b[8]&0x60 != 0:
		return ftypType(b)
	case len(b) >= 2 && b[0] == 0xFF && b[1]&0xE0 == 0xE0:
		// MPEG audio frame sync; AAC (ADTS) has the layer bits at 0
		switch {
		case b[1]&0x16 == 0x10:
			return &FileType{"audio/aac", "aac"}
		case b[1]&0x06 == 0x02:
			return &FileType{"audio/mpeg", "mp3"}
		case b[1]&0x06 == 0x04:
			return &FileType{"audio/mpeg", "mp2"}
		case b[1]&0x06 == 0x06:
			return &FileType{"audio/mpeg", "mp1"}
		}
	}
	return nil
}

func ftypType(b []byte) *FileType {
	end := min(len(b), 12)
	brand := string(bytes.TrimSpace(bytes.Replace(b[8:end], []byte{0}, []byte{' '}, 1)))
	switch brand {
	case "avif", "avis":
		return &FileType{"image/avif", "avif"}
	case "mif1", "msf1", "heic", "heix", "hevc", "hevx":
		return &FileType{"image/heif", "heic"}
	case "qt":
		return &FileType{"video/quicktime", "mov"}
	case "M4V", "M4VH", "M4VP":
		return &FileType{"video/x-m4v", "m4v"}
	case "M4P":
		return &FileType{"video/mp4", "m4p"}
	case "M4B":
		return &FileType{"audio/mp4", "m4b"}
	case "M4A":
		return &FileType{"audio/x-m4a", "m4a"}
	case "F4V":
		return &FileType{"video/mp4", "f4v"}
	case "F4P":
		return &FileType{"video/mp4", "f4p"}
	case "F4A":
		return &FileType{"audio/mp4", "f4a"}
	case "F4B":
		return &FileType{"audio/mp4", "f4b"}
	case "crx":
		return &FileType{"image/x-canon-cr3", "cr3"}
	}
	if len(brand) >= 2 && brand[:2] == "3g" {
		if len(brand) >= 3 && brand[:3] == "3g2" {
			return &FileType{"video/3gpp2", "3g2"}
		}
		return &FileType{"video/3gpp", "3gp"}
	}
	return &FileType{"video/mp4", "mp4"}
}

func oggType(b []byte) *FileType {
	at := func(sig string) bool { return len(b) >= 28+len(sig) && string(b[28:28+len(sig)]) == sig }
	switch {
	case at("OpusHead"):
		return &FileType{"audio/ogg", "opus"}
	case at("\x80theora"):
		return &FileType{"video/ogg", "ogv"}
	case at("\x01video\x00"):
		return &FileType{"video/ogg", "ogm"}
	case at("\x7FFLAC"):
		return &FileType{"audio/ogg", "oga"}
	case at("Speex  "):
		return &FileType{"audio/ogg", "spx"}
	case at("\x01vorbis"):
		return &FileType{"audio/ogg", "ogg"}
	}
	return &FileType{"application/ogg", "ogx"}
}

package payment

import (
	"strconv"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

// CodesService is the codes service.
type CodesService struct{}

func NewCodesService() *CodesService { return &CodesService{} }

// GenerateCodes returns 10000 lifetime-deal codes for a provider token, one
// per line, or "" when the token does not decrypt.
func (s *CodesService) GenerateCodes(providerToken string) string {
	decrypt, err := helpers.FixedDecryption(providerToken)
	if err != nil {
		return ""
	}
	codes := make([]string, 10000)
	for index := range codes {
		code, err := helpers.FixedEncryption(decrypt + ":" + strconv.Itoa(index))
		if err != nil {
			return ""
		}
		codes[index] = code
	}
	return strings.Join(codes, "\n")
}

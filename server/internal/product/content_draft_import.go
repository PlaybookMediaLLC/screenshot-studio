package product

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
)

func draftImportIdentity(actor Actor, input ContentDraftInput) (string, string, error) {
	if input.ImportKey == "" {
		return "", "", nil
	}
	if len(input.ImportKey) < 16 || len(input.ImportKey) > 128 || strings.TrimSpace(input.ImportKey) != input.ImportKey {
		return "", "", invalid("Import keys must be 16 to 128 characters.")
	}
	actorID := actor.UserID
	if actor.KeyID != "" {
		actorID = "key:" + actor.KeyID
	}
	if actorID == "" {
		return "", "", invalid("Import needs an authenticated actor.")
	}
	if input.importScope != "" {
		actorID = input.importScope
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return "", "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(actor.OrganizationID+"/"+actorID+"/"+input.ImportKey))), fmt.Sprintf("%x", sha256.Sum256(encoded)), nil
}

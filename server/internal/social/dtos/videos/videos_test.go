package videos

import (
	"strings"
	"testing"
)

func TestVideoDtoValidate(t *testing.T) {
	t.Setenv("EVOLINK_API_KEY", "k")
	t.Setenv("FAL_KEY", "")
	if got := (&VideoDto{Type: "seedance", Output: "vertical"}).Validate(); len(got) != 0 {
		t.Errorf("valid: %v", got)
	}
	got := (&VideoDto{Type: "image-text-slides", Output: "square"}).Validate()
	if strings.Join(got, "|") != "type must be any of: seedance|output must be one of the following values: vertical, horizontal" {
		t.Errorf("%q", got)
	}
	if got := (&VideoFunctionDto{}).Validate(); len(got) != 2 {
		t.Errorf("%q", got)
	}
}

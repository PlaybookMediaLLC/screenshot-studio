package product

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestProjectCopyName(t *testing.T) {
	if got := projectCopyName("Launch", nil); got != "Launch copy" {
		t.Fatal(got)
	}
	if got := projectCopyName("Launch", []string{"Launch COPY", "Launch copy 2"}); got != "Launch copy 3" {
		t.Fatal(got)
	}
	long := strings.Repeat("界", projectNameLimit)
	first := projectCopyName(long, nil)
	second := projectCopyName(long, []string{first})
	if !utf8.ValidString(second) || utf8.RuneCountInString(second) != projectNameLimit || !strings.HasSuffix(second, " copy 2") {
		t.Fatal(second)
	}
}

package releaseautomation

import (
	"regexp"
	"strconv"
)

// versionPattern accepts semantic versions and their common short forms:
// v2, v2.3, 2.3.1, v2.3.1-beta.1, and build metadata after "+".
var versionPattern = regexp.MustCompile(`^[vV]?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]{1,100}))?(?:\+[0-9A-Za-z.-]{1,100})?$`)

// versionFields describes what kind of release a version name is. A name that
// is not a version reports every field not_applicable, so a condition on it
// asks for attention rather than silently choosing a branch.
func versionFields(name string) map[string]Value {
	match := versionPattern.FindStringSubmatch(name)
	fields := map[string]Value{}
	if match == nil {
		for _, field := range []string{"version.major", "version.minor", "version.patch", "version.prerelease", "version.level"} {
			fields[field] = Value{State: "not_applicable"}
		}
		return fields
	}
	part := func(text string) string {
		if text == "" {
			return "0"
		}
		number, _ := strconv.Atoi(text)
		return strconv.Itoa(number)
	}
	major, minor, patch := part(match[1]), part(match[2]), part(match[3])
	level := "major"
	switch {
	case match[4] != "":
		level = "prerelease"
	case patch != "0":
		level = "patch"
	case minor != "0":
		level = "minor"
	}
	fields["version.major"], fields["version.minor"], fields["version.patch"] = StringValue(major), StringValue(minor), StringValue(patch)
	fields["version.prerelease"], fields["version.level"] = StringValue(match[4]), StringValue(level)
	return fields
}

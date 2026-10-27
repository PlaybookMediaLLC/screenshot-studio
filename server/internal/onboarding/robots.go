package onboarding

import (
	"regexp"
	"strings"
)

// Robots is a parsed robots.txt, read as RFC 9309 describes: a crawler uses
// the groups that name it (or `*` when none do), the longest matching rule
// wins, and allow wins a tie. A port of lib/link-preview/robots.ts.
type Robots struct {
	groups   []robotsGroup
	Sitemaps []string
}

type robotsRule struct {
	allow bool
	path  string
}

type robotsGroup struct {
	agents []string
	rules  []robotsRule
}

var robotsLine = regexp.MustCompile(`(?i)^\s*([a-z-]+)\s*:\s*(.*?)\s*$`)

// ParseRobots reads robots.txt text; an empty text allows everything.
func ParseRobots(text string) *Robots {
	robots := &Robots{}
	var current *robotsGroup
	collecting := false
	for _, raw := range strings.Split(text, "\n") {
		if i := strings.IndexByte(raw, '#'); i >= 0 {
			raw = raw[:i]
		}
		match := robotsLine.FindStringSubmatch(strings.TrimRight(raw, "\r"))
		if match == nil {
			continue
		}
		field, value := strings.ToLower(match[1]), match[2]
		switch field {
		case "user-agent":
			if current == nil || !collecting {
				robots.groups = append(robots.groups, robotsGroup{})
				current = &robots.groups[len(robots.groups)-1]
			}
			current.agents = append(current.agents, strings.ToLower(value))
			collecting = true
		case "allow", "disallow":
			collecting = false
			if current != nil && value != "" {
				current.rules = append(current.rules, robotsRule{allow: field == "allow", path: value})
			}
		case "sitemap":
			if value != "" && len(robots.Sitemaps) < 5 {
				robots.Sitemaps = append(robots.Sitemaps, value)
			}
		}
	}
	return robots
}

func robotsMatches(pattern, path string) bool {
	anchored := strings.HasSuffix(pattern, "$")
	parts := strings.Split(strings.TrimSuffix(pattern, "$"), "*")
	for i, part := range parts {
		parts[i] = regexp.QuoteMeta(part)
	}
	source := "^" + strings.Join(parts, ".*")
	if anchored {
		source += "$"
	}
	matched, err := regexp.MatchString(source, path)
	return err == nil && matched
}

// Allows reports whether our crawler may read path (with its query).
func (r *Robots) Allows(path string) bool {
	if r == nil {
		return true
	}
	name := strings.ToLower(RobotsToken)
	var applicable []robotsGroup
	for _, group := range r.groups {
		for _, agent := range group.agents {
			if agent != "*" && strings.HasPrefix(name, agent) {
				applicable = append(applicable, group)
				break
			}
		}
	}
	if len(applicable) == 0 {
		for _, group := range r.groups {
			for _, agent := range group.agents {
				if agent == "*" {
					applicable = append(applicable, group)
					break
				}
			}
		}
	}
	var best *robotsRule
	for _, group := range applicable {
		for i := range group.rules {
			rule := &group.rules[i]
			if !robotsMatches(rule.path, path) {
				continue
			}
			if best == nil || len(rule.path) > len(best.path) || (len(rule.path) == len(best.path) && rule.allow) {
				best = rule
			}
		}
	}
	return best == nil || best.allow
}

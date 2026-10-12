package helpers

import (
	"net/url"
	"os"
	"regexp"
	"strings"
)

// ConfigurationChecker is configuration/configuration.checker.ts, run at
// backend startup: ReadEnvFromProcess, Check, then report the issues.
type ConfigurationChecker struct {
	cfg    map[string]string
	issues []string
}

func (c *ConfigurationChecker) ReadEnvFromProcess() {
	c.cfg = map[string]string{}
	for _, kv := range os.Environ() {
		if k, v, ok := strings.Cut(kv, "="); ok {
			c.cfg[k] = v
		}
	}
}

func (c *ConfigurationChecker) Check() {
	c.CheckDatabaseServers()
	c.CheckNonEmpty("JWT_SECRET", "")
	c.CheckIsValidURL("MAIN_URL")
	c.CheckIsValidURL("FRONTEND_URL")
	c.CheckIsValidURL("NEXT_PUBLIC_BACKEND_URL")
	c.CheckIsValidURL("BACKEND_INTERNAL_URL")
	c.CheckNonEmpty("STORAGE_PROVIDER", "Needed to setup storage.")
}

func (c *ConfigurationChecker) CheckNonEmpty(key, description string) bool {
	if c.Get(key) == "" {
		c.issues = append(c.issues, key+" not set. "+description)
		return false
	}
	return true
}

func (c *ConfigurationChecker) Get(key string) string { return c.cfg[key] }

func (c *ConfigurationChecker) CheckDatabaseServers() {
	c.CheckRedis()
	c.CheckIsValidURL("DATABASE_URL")
}

func (c *ConfigurationChecker) CheckRedis() {
	redisURL := c.cfg["REDIS_URL"]
	if redisURL == "" {
		c.issues = append(c.issues, "REDIS_URL not set")
	}

	scheme, valid := parseJSURL(redisURL)
	if !valid {
		c.issues = append(c.issues, "REDIS_URL is not a valid URL")
		return
	}
	if scheme != "redis" {
		c.issues = append(c.issues, "REDIS_URL must start with redis://")
	}
}

func (c *ConfigurationChecker) CheckIsValidURL(key string) {
	if !c.CheckNonEmpty(key, "") {
		return
	}
	urlString := c.Get(key)
	if _, valid := parseJSURL(urlString); !valid {
		c.issues = append(c.issues, key+" is not a valid URL")
	}
	if strings.HasSuffix(urlString, "/") {
		c.issues = append(c.issues, key+" should not end with /")
	}
}

func (c *ConfigurationChecker) HasIssues() bool { return len(c.issues) > 0 }

func (c *ConfigurationChecker) GetIssues() []string { return c.issues }

func (c *ConfigurationChecker) GetIssuesCount() int { return len(c.issues) }

var (
	urlSchemeRe   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.\-]*:`)
	specialScheme = map[string]bool{"http": true, "https": true, "ws": true, "wss": true, "ftp": true}
)

// parseJSURL approximates `new URL(s)` (WHATWG): an absolute URL needs a
// scheme, and special schemes need a host with a valid port.
// ponytail: not a full WHATWG parser, enough for env-var sanity checks.
func parseJSURL(s string) (scheme string, valid bool) {
	s = strings.TrimFunc(s, func(r rune) bool { return r <= 0x20 })
	m := urlSchemeRe.FindString(s)
	if m == "" {
		return "", false
	}
	scheme = strings.ToLower(strings.TrimSuffix(m, ":"))
	if !specialScheme[scheme] {
		return scheme, true
	}
	rest := strings.TrimLeft(s[len(m):], `/\`)
	if i := strings.IndexAny(rest, `/\?#`); i >= 0 {
		rest = rest[:i]
	}
	if i := strings.LastIndex(rest, "@"); i >= 0 {
		rest = rest[i+1:]
	}
	u, err := url.Parse("http://" + rest)
	if err != nil || u.Hostname() == "" || strings.ContainsAny(u.Hostname(), " <>^|%") {
		return scheme, false
	}
	return scheme, true
}

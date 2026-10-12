package chat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Schema is the part of zod the tool schemas use. It marshals to the JSON
// schema zod-to-json-schema produced for Mastra, and validates input with
// zod's messages.
type Schema struct {
	Type        string // string | number | integer | boolean | array | object | any
	Description string
	Optional    bool
	Nullable    bool
	Enum        []string
	Format      string // "uri" for z.string().url()
	Minimum     *float64
	Maximum     *float64
	MaxItems    *int
	Items       *Schema
	Props       []Prop
	Passthrough bool
	// Record is z.record(z.string(), z.any()).
	Record bool
	AnyOf  []*Schema
}

type Prop struct {
	Name   string
	Schema *Schema
}

func zString() *Schema                      { return &Schema{Type: "string"} }
func zNumber() *Schema                      { return &Schema{Type: "number"} }
func zInt() *Schema                         { return &Schema{Type: "integer"} }
func zBool() *Schema                        { return &Schema{Type: "boolean"} }
func zAny() *Schema                         { return &Schema{Type: "any"} }
func zArray(items *Schema) *Schema          { return &Schema{Type: "array", Items: items} }
func zEnum(values ...string) *Schema        { return &Schema{Type: "string", Enum: values} }
func zRecord() *Schema                      { return &Schema{Type: "object", Record: true} }
func zUnion(options ...*Schema) *Schema     { return &Schema{AnyOf: options} }
func zObject(props ...Prop) *Schema         { return &Schema{Type: "object", Props: props} }
func field(name string, s *Schema) Prop     { return Prop{Name: name, Schema: s} }
func (s *Schema) describe(d string) *Schema { s.Description = d; return s }
func (s *Schema) optional() *Schema         { s.Optional = true; return s }
func (s *Schema) nullable() *Schema         { s.Nullable = true; return s }
func (s *Schema) url() *Schema              { s.Format = "uri"; return s }
func (s *Schema) min(n float64) *Schema     { s.Minimum = &n; return s }
func (s *Schema) max(n float64) *Schema     { s.Maximum = &n; return s }
func (s *Schema) maxItems(n int) *Schema    { s.MaxItems = &n; return s }
func (s *Schema) passthrough() *Schema      { s.Passthrough = true; return s }

func writeKey(buf *bytes.Buffer, first *bool, key string, value any) {
	if !*first {
		buf.WriteByte(',')
	}
	*first = false
	k, _ := json.Marshal(key)
	buf.Write(k)
	buf.WriteByte(':')
	v, _ := json.Marshal(value)
	buf.Write(v)
}

// MarshalJSON keeps zod-to-json-schema's key order.
func (s *Schema) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	first := true
	if len(s.AnyOf) > 0 {
		writeKey(&buf, &first, "anyOf", s.AnyOf)
	} else if s.Type != "any" {
		if s.Nullable {
			writeKey(&buf, &first, "type", []string{s.Type, "null"})
		} else {
			writeKey(&buf, &first, "type", s.Type)
		}
	}
	switch s.Type {
	case "string":
		if s.Format != "" {
			writeKey(&buf, &first, "format", s.Format)
		}
		if len(s.Enum) > 0 {
			writeKey(&buf, &first, "enum", s.Enum)
		}
	case "number", "integer":
		if s.Minimum != nil {
			writeKey(&buf, &first, "minimum", *s.Minimum)
		}
		if s.Maximum != nil {
			writeKey(&buf, &first, "maximum", *s.Maximum)
		}
	case "array":
		writeKey(&buf, &first, "items", s.Items)
		if s.MaxItems != nil {
			writeKey(&buf, &first, "maxItems", *s.MaxItems)
		}
	case "object":
		if s.Record {
			writeKey(&buf, &first, "additionalProperties", map[string]any{})
			break
		}
		var props bytes.Buffer
		props.WriteByte('{')
		pfirst := true
		var required []string
		for _, p := range s.Props {
			writeKey(&props, &pfirst, p.Name, p.Schema)
			// zod-to-json-schema skips what accepts undefined (optional, z.any())
			if !p.Schema.Optional && p.Schema.Type != "any" {
				required = append(required, p.Name)
			}
		}
		props.WriteByte('}')
		writeKey(&buf, &first, "properties", json.RawMessage(props.Bytes()))
		if len(required) > 0 {
			writeKey(&buf, &first, "required", required)
		}
		writeKey(&buf, &first, "additionalProperties", s.Passthrough)
	}
	if s.Description != "" {
		writeKey(&buf, &first, "description", s.Description)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// JSON is the schema as a raw JSON value.
func (s *Schema) JSON() json.RawMessage {
	data, _ := s.MarshalJSON()
	return data
}

func isURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "")
}

func join(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}

func jsType(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	return "unknown"
}

// Check validates a decoded JSON value and returns zod's issues.
func (s *Schema) Check(value any, path string) []Issue {
	if value == nil {
		if s.Nullable || s.Type == "any" {
			return nil
		}
		if s.Optional {
			return nil
		}
		return []Issue{{path, "Required"}}
	}
	if len(s.AnyOf) > 0 {
		for _, option := range s.AnyOf {
			if len(option.Check(value, path)) == 0 {
				return nil
			}
		}
		return []Issue{{path, "Invalid input"}}
	}
	actual := jsType(value)
	expected := s.Type
	switch {
	case expected == "any":
		return nil
	case expected == "integer" && actual == "number":
	case expected != actual:
		return []Issue{{path, fmt.Sprintf("Expected %s, received %s", expected, actual)}}
	}

	var issues []Issue
	switch expected {
	case "string":
		v := value.(string)
		if len(s.Enum) > 0 {
			found := false
			options := make([]string, len(s.Enum))
			for i, e := range s.Enum {
				options[i] = "'" + e + "'"
				found = found || e == v
			}
			if !found {
				issues = append(issues, Issue{path, fmt.Sprintf("Invalid enum value. Expected %s, received '%s'", strings.Join(options, " | "), v)})
			}
		}
		if s.Format == "uri" && !isURL(v) {
			issues = append(issues, Issue{path, "Invalid url"})
		}
	case "integer", "number":
		n := value.(float64)
		if expected == "integer" && n != float64(int64(n)) {
			issues = append(issues, Issue{path, "Expected integer, received float"})
		}
		if s.Minimum != nil && n < *s.Minimum {
			issues = append(issues, Issue{path, fmt.Sprintf("Number must be greater than or equal to %v", *s.Minimum)})
		}
		if s.Maximum != nil && n > *s.Maximum {
			issues = append(issues, Issue{path, fmt.Sprintf("Number must be less than or equal to %v", *s.Maximum)})
		}
	case "array":
		list := value.([]any)
		if s.MaxItems != nil && len(list) > *s.MaxItems {
			issues = append(issues, Issue{path, fmt.Sprintf("Array must contain at most %d element(s)", *s.MaxItems)})
		}
		for i, item := range list {
			issues = append(issues, s.Items.Check(item, join(path, fmt.Sprint(i)))...)
		}
	case "object":
		obj := value.(map[string]any)
		for _, p := range s.Props {
			issues = append(issues, p.Schema.Check(obj[p.Name], join(path, p.Name))...)
		}
	}
	return issues
}

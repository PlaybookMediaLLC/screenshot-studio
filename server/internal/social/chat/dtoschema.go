package chat

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
)

var rawMessageType = reflect.TypeOf(json.RawMessage{})

// ValidationSchema is getValidationSchemas()[dto.name]: the JSON schema
// class-validator-jsonschema derives from a DTO, here from the Go DTO's json
// and validate tags, nested DTOs inlined (the NESTED_VALIDATION converter).
// It returns nil for a nil DTO.
func ValidationSchema(dto any) any {
	if dto == nil {
		return nil
	}
	t := reflect.TypeOf(dto)
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return nil
	}
	return json.RawMessage(structSchema(t, map[reflect.Type]bool{}))
}

func structSchema(t reflect.Type, seen map[reflect.Type]bool) []byte {
	seen[t] = true
	defer delete(seen, t)
	var props bytes.Buffer
	props.WriteByte('{')
	first := true
	var required []string
	var walk func(t reflect.Type)
	walk = func(t reflect.Type) {
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if f.Anonymous && f.Type.Kind() == reflect.Struct && f.Tag.Get("json") == "" {
				walk(f.Type)
				continue
			}
			if !f.IsExported() {
				continue
			}
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name == "-" {
				continue
			}
			if name == "" {
				name = f.Name
			}
			rules := strings.Split(f.Tag.Get("validate"), ",")
			if hasRule(rules, "required") {
				required = append(required, name)
			}
			writeKey(&props, &first, name, json.RawMessage(fieldSchema(f.Type, rules, seen)))
		}
	}
	walk(t)
	props.WriteByte('}')

	var buf bytes.Buffer
	buf.WriteByte('{')
	first = true
	writeKey(&buf, &first, "properties", json.RawMessage(props.Bytes()))
	writeKey(&buf, &first, "type", "object")
	if len(required) > 0 {
		writeKey(&buf, &first, "required", required)
	}
	buf.WriteByte('}')
	return buf.Bytes()
}

func hasRule(rules []string, name string) bool {
	for _, r := range rules {
		if r == name {
			return true
		}
	}
	return false
}

func ruleValue(rules []string, name string) (string, bool) {
	for _, r := range rules {
		if v, ok := strings.CutPrefix(r, name+"="); ok {
			return v, true
		}
	}
	return "", false
}

func fieldSchema(t reflect.Type, rules []string, seen map[reflect.Type]bool) []byte {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	first := true
	limit := func(min, max string) {
		if v, ok := ruleValue(rules, "min"); ok {
			if n, err := strconv.Atoi(v); err == nil {
				writeKey(&buf, &first, min, n)
			}
		}
		if v, ok := ruleValue(rules, "max"); ok {
			if n, err := strconv.Atoi(v); err == nil {
				writeKey(&buf, &first, max, n)
			}
		}
	}
	switch {
	case t == rawMessageType || t.Kind() == reflect.Interface || t.Kind() == reflect.Map:
	case t.Kind() == reflect.String:
		writeKey(&buf, &first, "type", "string")
		if v, ok := ruleValue(rules, "oneof"); ok {
			writeKey(&buf, &first, "enum", strings.Fields(v))
		}
		if hasRule(rules, "url") || hasRule(rules, "http_url") {
			writeKey(&buf, &first, "format", "url")
		}
		limit("minLength", "maxLength")
	case t.Kind() == reflect.Bool:
		writeKey(&buf, &first, "type", "boolean")
	case t.Kind() >= reflect.Int && t.Kind() <= reflect.Uint64:
		writeKey(&buf, &first, "type", "integer")
		limit("minimum", "maximum")
	case t.Kind() == reflect.Float32 || t.Kind() == reflect.Float64:
		writeKey(&buf, &first, "type", "number")
		limit("minimum", "maximum")
	case t.Kind() == reflect.Slice || t.Kind() == reflect.Array:
		writeKey(&buf, &first, "type", "array")
		elem := t.Elem()
		for elem.Kind() == reflect.Pointer {
			elem = elem.Elem()
		}
		if elem.Kind() == reflect.Struct && !seen[elem] {
			writeKey(&buf, &first, "items", json.RawMessage(structSchema(elem, seen)))
		} else {
			writeKey(&buf, &first, "items", map[string]any{})
		}
		limit("minItems", "maxItems")
	case t.Kind() == reflect.Struct && !seen[t]:
		return structSchema(t, seen)
	}
	buf.WriteByte('}')
	return buf.Bytes()
}

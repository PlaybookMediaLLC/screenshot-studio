// Package shotsapi is the public REST contract as Go reads it: the OpenAPI
// document that `npm run api:generate` writes from the web's zod contracts.
// The MCP server builds each tool from the operation it mirrors (schema,
// API-key scope, plan gate, and quota), so there is no second spec to drift.
package shotsapi

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"sync"
)

//go:embed openapi.json
var document []byte

// Entitlement is an operation's `x-shots-entitlement`: the feature it needs,
// the plan that includes it, and the quota it consumes ("" when none).
type Entitlement struct {
	Feature     string `json:"feature"`
	MinimumPlan string `json:"minimumPlan"`
	Quota       string `json:"quota"`
}

// Parameter is a path, query, or header parameter and the tool argument
// that carries it.
type Parameter struct {
	// Argument is the tool input property: the parameter name, or the header
	// name in camelCase (Idempotency-Key becomes idempotencyKey).
	Argument string
	In       string
	Name     string
	Required bool
}

// Operation is one documented REST operation.
type Operation struct {
	ID          string
	Method      string
	Path        string
	Summary     string
	Description string
	// Scope is the API-key scope the operation requires, "" when it refuses keys.
	Scope       string
	Entitlement Entitlement
	Parameters  []Parameter
	// InputSchema merges the parameters and the JSON body into one object
	// schema with every $ref inlined. Unknown arguments are refused.
	InputSchema map[string]any
	// OutputSchema is the success response schema, nil unless it is a JSON object.
	OutputSchema map[string]any
}

type openAPI struct {
	Paths      map[string]map[string]rawOperation `json:"paths"`
	Components struct {
		Schemas map[string]any `json:"schemas"`
	} `json:"components"`
}

type rawOperation struct {
	OperationID string                `json:"operationId"`
	Summary     string                `json:"summary"`
	Description string                `json:"description"`
	Security    []map[string][]string `json:"security"`
	Entitlement *Entitlement          `json:"x-shots-entitlement"`
	Parameters  []struct {
		Name        string         `json:"name"`
		In          string         `json:"in"`
		Required    bool           `json:"required"`
		Description string         `json:"description"`
		Schema      map[string]any `json:"schema"`
	} `json:"parameters"`
	RequestBody *struct {
		Content map[string]struct {
			Schema map[string]any `json:"schema"`
		} `json:"content"`
	} `json:"requestBody"`
	Responses map[string]struct {
		Content map[string]struct {
			Schema map[string]any `json:"schema"`
		} `json:"content"`
	} `json:"responses"`
}

// catalog is every operation, or why it cannot be a tool (a multipart body).
type catalog struct {
	operations map[string]*Operation
	problems   map[string]error
}

var load = sync.OnceValues(func() (*catalog, error) { return parse(document) })

// Document is the embedded OpenAPI document, byte for byte.
func Document() []byte { return document }

// Lookup returns the operation with operationId id.
func Lookup(id string) (*Operation, error) {
	loaded, err := load()
	if err != nil {
		return nil, err
	}
	if problem := loaded.problems[id]; problem != nil {
		return nil, problem
	}
	operation := loaded.operations[id]
	if operation == nil {
		return nil, fmt.Errorf("shotsapi: no operation %q in the OpenAPI document", id)
	}
	return operation, nil
}

func parse(data []byte) (*catalog, error) {
	var spec openAPI
	if err := json.Unmarshal(data, &spec); err != nil {
		return nil, fmt.Errorf("shotsapi: %w", err)
	}
	loaded := &catalog{operations: map[string]*Operation{}, problems: map[string]error{}}
	for path, item := range spec.Paths {
		for method, raw := range item {
			if raw.OperationID == "" {
				continue
			}
			operation, err := build(spec.Components.Schemas, path, strings.ToUpper(method), raw)
			if err != nil {
				loaded.problems[raw.OperationID] = fmt.Errorf("shotsapi: %s: %w", raw.OperationID, err)
				continue
			}
			loaded.operations[raw.OperationID] = operation
		}
	}
	return loaded, nil
}

func build(components map[string]any, path, method string, raw rawOperation) (*Operation, error) {
	operation := &Operation{ID: raw.OperationID, Method: method, Path: path, Summary: raw.Summary,
		Description: raw.Description}
	for _, requirement := range raw.Security {
		if scopes, ok := requirement["workspaceApiKey"]; ok && len(scopes) == 1 {
			operation.Scope = scopes[0]
		}
	}
	if raw.Entitlement != nil {
		operation.Entitlement = *raw.Entitlement
	}
	properties := map[string]any{}
	required := []string{}
	add := func(name string, schema any, mandatory bool) error {
		if _, taken := properties[name]; taken {
			return fmt.Errorf("argument %q is declared twice", name)
		}
		properties[name] = schema
		if mandatory {
			required = append(required, name)
		}
		return nil
	}
	for _, parameter := range raw.Parameters {
		argument := parameter.Name
		if parameter.In == "header" {
			argument = camelCase(parameter.Name)
		}
		schema, err := inline(components, parameter.Schema, 0)
		if err != nil {
			return nil, err
		}
		if parameter.Description != "" {
			schema.(map[string]any)["description"] = parameter.Description
		}
		if err := add(argument, schema, parameter.Required); err != nil {
			return nil, err
		}
		operation.Parameters = append(operation.Parameters,
			Parameter{Argument: argument, In: parameter.In, Name: parameter.Name, Required: parameter.Required})
	}
	var bodyUnion map[string]any
	if raw.RequestBody != nil {
		content, ok := raw.RequestBody.Content["application/json"]
		if !ok {
			return nil, fmt.Errorf("the request body is not JSON")
		}
		resolved, err := inline(components, content.Schema, 0)
		if err != nil {
			return nil, err
		}
		body, _ := resolved.(map[string]any)
		if body["type"] == "object" {
			bodyProperties, _ := body["properties"].(map[string]any)
			bodyRequired, _ := body["required"].([]any)
			for name, schema := range bodyProperties {
				mandatory := false
				for _, item := range bodyRequired {
					mandatory = mandatory || item == name
				}
				if err := add(name, schema, mandatory); err != nil {
					return nil, err
				}
			}
		} else {
			// Preserve each discriminated action's required and forbidden fields.
			// Flatten path/query parameters into every branch, never erase the union.
			var err error
			bodyUnion, err = mergeUnionInput(body, properties, required)
			if err != nil {
				return nil, err
			}
		}
	}
	operation.InputSchema = map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		operation.InputSchema["required"] = required
	}
	if bodyUnion != nil {
		operation.InputSchema = bodyUnion
	}
	for _, status := range []string{"200", "201", "202"} {
		response, ok := raw.Responses[status]
		if !ok {
			continue
		}
		if content, ok := response.Content["application/json"]; ok {
			schema, err := inline(components, content.Schema, 0)
			if err != nil {
				return nil, err
			}
			if object, ok := schema.(map[string]any); ok && object["type"] == "object" {
				operation.OutputSchema = object
			}
		}
		break
	}
	return operation, nil
}

// mergeUnionInput derives MCP arguments from an object union and the REST
// parameters, retaining branch validation and rejecting name collisions.
func mergeUnionInput(body, parameters map[string]any, required []string) (map[string]any, error) {
	keyword := "oneOf"
	branches, ok := body[keyword].([]any)
	if !ok {
		keyword = "anyOf"
		branches, ok = body[keyword].([]any)
	}
	if !ok || len(branches) == 0 {
		return nil, fmt.Errorf("the request body is not an object or object union")
	}
	allProperties := maps.Clone(parameters)
	combined := []any{}
	for _, raw := range branches {
		branch, ok := raw.(map[string]any)
		if !ok || branch["type"] != "object" {
			return nil, fmt.Errorf("every request body union branch must be an object")
		}
		properties := maps.Clone(parameters)
		branchProperties, _ := branch["properties"].(map[string]any)
		for name, schema := range branchProperties {
			if _, taken := parameters[name]; taken {
				return nil, fmt.Errorf("argument %q is declared twice", name)
			}
			properties[name] = schema
			// The branch, not this union of names, owns the field's validation.
			allProperties[name] = map[string]any{}
		}
		mandatory := []any{}
		for _, name := range required {
			mandatory = append(mandatory, name)
		}
		if names, ok := branch["required"].([]any); ok {
			mandatory = append(mandatory, names...)
		}
		merged := maps.Clone(branch)
		merged["properties"], merged["required"], merged["additionalProperties"] = properties, mandatory, false
		combined = append(combined, merged)
	}
	return map[string]any{"type": "object", "properties": allProperties, "additionalProperties": false, keyword: combined}, nil
}

// inline returns a deep copy of schema with every local $ref replaced by the
// component it names.
func inline(components map[string]any, schema any, depth int) (any, error) {
	if depth > 32 {
		return nil, fmt.Errorf("schema references nest too deeply")
	}
	switch value := schema.(type) {
	case map[string]any:
		if ref, ok := value["$ref"].(string); ok {
			name, found := strings.CutPrefix(ref, "#/components/schemas/")
			if !found || components[name] == nil {
				return nil, fmt.Errorf("unresolvable reference %q", ref)
			}
			return inline(components, components[name], depth+1)
		}
		copied := make(map[string]any, len(value))
		for key, item := range value {
			resolved, err := inline(components, item, depth+1)
			if err != nil {
				return nil, err
			}
			copied[key] = resolved
		}
		return copied, nil
	case []any:
		copied := make([]any, len(value))
		for i, item := range value {
			resolved, err := inline(components, item, depth+1)
			if err != nil {
				return nil, err
			}
			copied[i] = resolved
		}
		return copied, nil
	default:
		return value, nil
	}
}

// camelCase turns a header name such as Idempotency-Key into idempotencyKey.
func camelCase(header string) string {
	parts := strings.Split(header, "-")
	for i, part := range parts {
		if i == 0 {
			parts[i] = strings.ToLower(part)
		} else if part != "" {
			parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
	}
	return strings.Join(parts, "")
}

// Project keeps only what schema declares, the way the REST routes strip
// fields outside their response contract. value must be JSON-shaped (the
// result of json.Unmarshal into any).
func Project(value any, schema map[string]any) any {
	if schema == nil || value == nil {
		return value
	}
	for _, key := range []string{"anyOf", "oneOf"} {
		if branches, ok := schema[key].([]any); ok {
			for _, branch := range branches {
				if candidate, ok := branch.(map[string]any); ok && candidate["type"] != "null" {
					return Project(value, candidate)
				}
			}
			return value
		}
	}
	switch typed := value.(type) {
	case map[string]any:
		properties, ok := schema["properties"].(map[string]any)
		if !ok {
			return typed
		}
		projected := make(map[string]any, len(properties))
		for name, property := range properties {
			if item, present := typed[name]; present {
				child, _ := property.(map[string]any)
				projected[name] = Project(item, child)
			}
		}
		return projected
	case []any:
		items, _ := schema["items"].(map[string]any)
		projected := make([]any, len(typed))
		for i, item := range typed {
			projected[i] = Project(item, items)
		}
		return projected
	default:
		return value
	}
}

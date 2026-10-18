package shotsapi

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const fixture = `{
  "paths": {
    "/api/v1/things/{thingId}": {
      "post": {
        "operationId": "createThing", "summary": "Create a thing", "description": "Makes one.",
        "security": [{"workspaceApiKey": ["release:create"]}, {"workspaceSession": []}],
        "x-shots-entitlement": {"feature": "campaign:workflow", "minimumPlan": "pro", "quota": "api:write:minute"},
        "parameters": [
          {"in": "path", "name": "thingId", "required": true, "schema": {"type": "string"}},
          {"in": "header", "name": "Idempotency-Key", "required": false, "schema": {"type": "string", "maxLength": 128}}
        ],
        "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/ThingRequest"}}}},
        "responses": {"201": {"content": {"application/json": {"schema": {"type": "object",
          "properties": {"thing": {"$ref": "#/components/schemas/Thing"}}}}}}}
      }
    },
    "/api/upload": {"post": {"operationId": "upload", "requestBody": {"content": {"multipart/form-data": {"schema": {}}}}}}
  },
  "components": {"schemas": {
    "ThingRequest": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    "Thing": {"type": "object", "properties": {"id": {"type": "string"}, "owner": {"anyOf": [
      {"type": "object", "properties": {"name": {"type": "string"}}}, {"type": "null"}]}}}
  }}
}`

func TestParseMergesParametersAndBodyIntoOneToolInput(t *testing.T) {
	loaded, err := parse([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	operation := loaded.operations["createThing"]
	if operation.Scope != "release:create" || operation.Entitlement != (Entitlement{"campaign:workflow", "pro", "api:write:minute"}) {
		t.Fatalf("policy=%q %+v", operation.Scope, operation.Entitlement)
	}
	properties := operation.InputSchema["properties"].(map[string]any)
	if _, ok := properties["idempotencyKey"]; !ok || properties["name"] == nil || properties["thingId"] == nil {
		t.Fatalf("properties=%v", properties)
	}
	if !reflect.DeepEqual(operation.InputSchema["required"], []string{"thingId", "name"}) ||
		operation.InputSchema["additionalProperties"] != false {
		t.Fatalf("input=%v", operation.InputSchema)
	}
	thing := operation.OutputSchema["properties"].(map[string]any)["thing"].(map[string]any)
	if thing["type"] != "object" {
		t.Fatalf("the output $ref was not inlined: %v", thing)
	}
	if loaded.problems["upload"] == nil || !strings.Contains(loaded.problems["upload"].Error(), "not JSON") {
		t.Fatalf("a multipart operation became a tool: %v", loaded.problems)
	}
}

func TestProjectKeepsOnlyDeclaredFields(t *testing.T) {
	loaded, _ := parse([]byte(fixture))
	schema := loaded.operations["createThing"].OutputSchema
	var value any
	_ = json.Unmarshal([]byte(`{"thing":{"id":"t1","objectKey":"org/secret","owner":{"name":"A","email":"a@b.c"}},"extra":1}`), &value)
	got, _ := json.Marshal(Project(value, schema))
	if string(got) != `{"thing":{"id":"t1","owner":{"name":"A"}}}` {
		t.Fatalf("projected=%s", got)
	}
	_ = json.Unmarshal([]byte(`{"thing":{"id":"t2","owner":null}}`), &value)
	if got, _ := json.Marshal(Project(value, schema)); string(got) != `{"thing":{"id":"t2","owner":null}}` {
		t.Fatalf("null branch=%s", got)
	}
}

func TestTheEmbeddedDocumentHasTheAgentOperations(t *testing.T) {
	for _, id := range []string{"listCampaigns", "createCampaign", "requestCampaignReview", "captureScreenshot"} {
		operation, err := Lookup(id)
		if err != nil || operation.Scope == "" || operation.Entitlement.Feature == "" {
			t.Fatalf("%s: %+v %v", id, operation, err)
		}
	}
	if camelCase("Idempotency-Key") != "idempotencyKey" || camelCase("X-Request-Id") != "xRequestId" {
		t.Fatal("header arguments are not camelCase")
	}
}

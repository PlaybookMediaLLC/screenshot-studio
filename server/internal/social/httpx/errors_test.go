package httpx

import (
	"encoding/json"
	"testing"
)

func TestNestExceptionBodies(t *testing.T) {
	cases := []struct {
		err  *Error
		want string
	}{
		{BadRequest([]string{"a must be a string"}), `{"message":["a must be a string"],"error":"Bad Request","statusCode":400}`},
		{BadRequest("nope"), `{"message":"nope","error":"Bad Request","statusCode":400}`},
		{BadRequest(map[string]any{"msg": "x"}), `{"msg":"x"}`},
		{HTTPException("Forbidden", 403), `{"statusCode":403,"message":"Forbidden"}`},
	}
	for _, c := range cases {
		got, _ := json.Marshal(c.err.Body)
		if string(got) != c.want {
			t.Errorf("got %s want %s", got, c.want)
		}
	}
}

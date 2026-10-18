package deepgram

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTranscribeURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token dg" {
			w.WriteHeader(401)
			w.Write([]byte(`{"err_msg":"bad key"}`))
			return
		}
		w.Write([]byte(`{"results":{"channels":[{"detected_language":"fr","alternatives":[{"words":[
			{"word":"bonjour","punctuated_word":"Bonjour,","start":0.1,"end":0.5},{"word":"toi","start":0.6,"end":0.9}]}]}],
			"utterances":[{"start":0.1,"end":0.9,"transcript":"Bonjour, toi"}]}}`))
	}))
	defer srv.Close()
	listenURL = srv.URL

	t.Setenv("DEEPGRAM_API_KEY", "dg")
	got, err := NewService().TranscribeURL(context.Background(), "https://media/a.ogg")
	if err != nil || got.Language != "fr" || got.Origin != "transcribed" || len(got.Words) != 2 ||
		got.Words[0].Text != "Bonjour," || got.Words[1].Text != "toi" || got.Segments[0].Text != "Bonjour, toi" {
		t.Fatalf("%+v %v", got, err)
	}

	t.Setenv("DEEPGRAM_API_KEY", "x")
	if _, err := NewService().TranscribeURL(context.Background(), "u"); err == nil || err.Error() != `Deepgram 401: {"err_msg":"bad key"}` {
		t.Errorf("%v", err)
	}
}

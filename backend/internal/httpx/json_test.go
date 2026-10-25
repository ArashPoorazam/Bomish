package httpx

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRequiresOneBoundedDocument(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"valid", `{"name":"بومیش"}`, true},
		{"whitespace", "{\"name\":\"ok\"}\n\t ", true},
		{"unknown field", `{"other":1}`, false},
		{"second document", `{"name":"ok"} {"name":"ignored"}`, false},
		{"trailing garbage", `{"name":"ok"} invalid`, false},
		{"empty", "", false},
		{"oversize value", `{"name":"` + strings.Repeat("x", 1<<20) + `"}`, false},
		{"oversize trailing whitespace", `{"name":"ok"}` + strings.Repeat(" ", 1<<20), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var value struct {
				Name string `json:"name"`
			}
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/", strings.NewReader(tc.body))
			if got := Decode(w, r, &value); got != tc.valid {
				t.Fatalf("Decode = %v, want %v", got, tc.valid)
			}
			if !tc.valid && w.Code != 400 {
				t.Fatalf("status = %d", w.Code)
			}
		})
	}
}

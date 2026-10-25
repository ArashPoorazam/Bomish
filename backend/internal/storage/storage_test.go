package storage

import (
	"net/http/httptest"
	"testing"
)

func TestLocalReadAndWriteShareConfiguredRoot(t *testing.T) {
	store := Local{Root: t.TempDir()}
	t.Setenv("UPLOAD_DIR", t.TempDir())
	path, err := store.Put(t.Context(), "image.png", []byte("image content"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	store.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 || w.Body.String() != "image content" {
		t.Fatalf("read back: %d %q", w.Code, w.Body.String())
	}
}

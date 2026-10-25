package main

import (
	"context"
	"strings"
	"testing"
)

func TestPrepareLocalCopyRejectsUnsafeDestinationsBeforeConnecting(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("DATABASE_URL_FILE", "")
	t.Setenv("TOTP_ENCRYPTION_KEY_FILE", "")
	t.Setenv("TOTP_ENCRYPTION_KEY", "")
	name := "bomish_dev_" + strings.Repeat("a", 32)
	for _, url := range []string{
		"postgres://user@production:55432/" + name + "?sslmode=disable",
		"postgres://user@127.0.0.1:5432/" + name + "?sslmode=disable",
		"postgres://user@127.0.0.1:55432/bomish?sslmode=disable",
		"postgres://user@127.0.0.1:55432/" + name + "?sslmode=disable&host=production",
	} {
		t.Run(url, func(t *testing.T) {
			t.Setenv("DATABASE_URL", url)
			err := run(context.Background(), []string{"prepare-local-copy"})
			if err == nil || !strings.Contains(err.Error(), "launcher-created local staging database") {
				t.Fatalf("expected destination rejection, got %v", err)
			}
		})
	}
}

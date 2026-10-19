package runtimeconfig

import (
	"strings"
	"testing"
)

func TestProductionFailsClosed(t *testing.T) {
	for _, key := range []string{"STORE_MODE", "APP_ORIGIN", "TOTP_ENCRYPTION_KEY", "TRUSTED_PROXY_CIDRS", "SEED_DEMO", "SHIPPING_SIMULATED"} {
		t.Setenv(key, "")
	}
	t.Setenv("APP_ENV", "production")
	if _, err := Read(); err == nil {
		t.Fatal("missing config accepted")
	}
	t.Setenv("STORE_MODE", "catalog")
	t.Setenv("APP_ORIGIN", "https://bomish.ir")
	t.Setenv("TOTP_ENCRYPTION_KEY", strings.Repeat("ab", 32))
	t.Setenv("TRUSTED_PROXY_CIDRS", "172.30.0.0/24")
	if _, err := Read(); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"SEED_DEMO", "true"}, {"SHIPPING_SIMULATED", "true"}, {"STORE_MODE", "live"}, {"APP_ORIGIN", "http://bomish.ir"}, {"TRUSTED_PROXY_CIDRS", "0.0.0.0/0"}} {
		t.Run(pair[0], func(t *testing.T) {
			t.Setenv(pair[0], pair[1])
			if _, err := Read(); err == nil {
				t.Fatal("unsafe production config accepted")
			}
		})
	}
}

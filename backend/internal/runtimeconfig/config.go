package runtimeconfig

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Dev, CatalogOnly bool
	Origin           string
	TOTPKey          []byte
	TrustedProxies   []netip.Prefix
}

func LoadSecrets() error {
	for _, key := range []string{"DATABASE_URL", "TOTP_ENCRYPTION_KEY", "KAVENEGAR_API_KEY", "NESHAN_API_KEY", "SNAPP_API_KEY", "TAPIN_API_KEY"} {
		if file := os.Getenv(key + "_FILE"); file != "" {
			if os.Getenv(key) != "" {
				return fmt.Errorf("set only %s or %s_FILE", key, key)
			}
			data, err := os.ReadFile(file)
			if err != nil {
				return fmt.Errorf("read %s_FILE: %w", key, err)
			}
			if err = os.Setenv(key, strings.TrimSpace(string(data))); err != nil {
				return err
			}
		}
	}
	return nil
}
func Read() (Config, error) {
	c := Config{Dev: os.Getenv("APP_ENV") == "development", Origin: os.Getenv("APP_ORIGIN")}
	if !c.Dev && os.Getenv("APP_ENV") != "production" {
		return c, errors.New("APP_ENV must be development or production")
	}
	mode := os.Getenv("STORE_MODE")
	if mode != "" && mode != "catalog" && !(c.Dev && mode == "simulation") {
		return c, errors.New("STORE_MODE must be catalog (or simulation in development)")
	}
	c.CatalogOnly = mode == "catalog"
	if c.Origin == "" && c.Dev {
		c.Origin = "http://localhost:3000"
	}
	if key := os.Getenv("TOTP_ENCRYPTION_KEY"); key != "" {
		var err error
		c.TOTPKey, err = hex.DecodeString(key)
		if err != nil || len(c.TOTPKey) != 32 {
			return c, errors.New("TOTP_ENCRYPTION_KEY must be 64 hexadecimal characters")
		}
	}
	for _, value := range strings.Split(os.Getenv("TRUSTED_PROXY_CIDRS"), ",") {
		if strings.TrimSpace(value) == "" {
			continue
		}
		p, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil {
			return c, errors.New("invalid TRUSTED_PROXY_CIDRS")
		}
		if p.Bits() == 0 {
			return c, errors.New("trusting all proxy addresses is forbidden")
		}
		c.TrustedProxies = append(c.TrustedProxies, p)
	}
	if !c.Dev {
		if !c.CatalogOnly {
			return c, errors.New("production only supports STORE_MODE=catalog; live sales are not implemented")
		}
		u, err := url.Parse(c.Origin)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return c, errors.New("APP_ORIGIN must be an exact HTTPS origin without a trailing slash")
		}
		if len(c.TOTPKey) != 32 {
			return c, errors.New("production requires TOTP_ENCRYPTION_KEY_FILE")
		}
		if os.Getenv("SEED_DEMO") == "true" || os.Getenv("SHIPPING_SIMULATED") == "true" {
			return c, errors.New("demo seeding and shipping simulation are forbidden in production")
		}
		if len(c.TrustedProxies) == 0 {
			return c, errors.New("production requires explicit TRUSTED_PROXY_CIDRS")
		}
	}
	return c, nil
}

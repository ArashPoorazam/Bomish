package app

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"bomish/internal/security"
)

func passwordStaff(t *testing.T, a *App, role string) *client {
	t.Helper()
	c := newClient(t, a.Handler())
	var s struct {
		CSRF string `json:"csrf"`
	}
	c.ok(t, "GET", "/session?workspace=staff", nil, &s)
	c.csrf = s.CSRF
	c.ok(t, "POST", "/staff/login", map[string]string{"username": role, "password": DemoPassword}, nil)
	return c
}
func TestOmnisireRequiresSeparateOwnerVerification(t *testing.T) {
	a := setup(t)
	editor := passwordStaff(t, a, "editor")
	editor.ok(t, "GET", "/staff/products", nil, nil)
	if code, _ := editor.call("POST", "/omnisire/unlock", map[string]string{"code": security.TOTP(DemoTOTP, time.Now().Unix()/30)}); code != 403 {
		t.Fatalf("staff unlock: %d", code)
	}
	owner := passwordStaff(t, a, "owner")
	owner.ok(t, "GET", "/staff/products", nil, nil)
	for _, path := range []string{"/omnisire/summary", "/omnisire/members", "/omnisire/permission-options"} {
		if code, _ := owner.call("GET", path, nil); code != 428 {
			t.Fatalf("password bypass %s: %d", path, code)
		}
	}
	if code, _ := owner.call("POST", "/omnisire/unlock", map[string]string{"code": "bad"}); code != 401 {
		t.Fatal(code)
	}
	oldCookie := ""
	for _, c := range owner.cookies {
		if c.Name == "bomish_staff_session" {
			oldCookie = c.Value
		}
	}
	code := security.TOTP(DemoTOTP, time.Now().Unix()/30)
	owner.ok(t, "POST", "/omnisire/unlock", map[string]string{"code": code}, nil)
	owner.ok(t, "GET", "/omnisire/summary", nil, nil)
	for _, c := range owner.cookies {
		if c.Name == "bomish_staff_session" && c.Value == oldCookie {
			t.Fatal("elevation did not rotate token")
		}
	}
	another := passwordStaff(t, a, "owner")
	if status, _ := another.call("POST", "/omnisire/unlock", map[string]string{"code": code}); status != 401 {
		t.Fatalf("replay accepted: %d", status)
	}
	owner.ok(t, "POST", "/logout?workspace=staff", nil, nil)
	if status, _ := owner.call("GET", "/omnisire/summary", nil); status != 403 {
		t.Fatalf("logout bypass: %d", status)
	}
}
func TestProductionBootstrapAndRecovery(t *testing.T) {
	a := setup(t)
	a.TOTPKey = bytes.Repeat([]byte{7}, 32)
	a.Dev = false
	ctx := context.Background()
	// Use the existing fixture owner to verify bootstrap cannot overwrite it.
	secret := security.NewTOTPSecret()
	code := security.TOTP(secret, time.Now().Unix()/30)
	if err := a.BootstrapOwner(ctx, "Owner", "new-owner", "unique-long-password", secret, code, false); err == nil {
		t.Fatal("duplicate owner accepted")
	}
	if err := a.BootstrapOwner(ctx, "Owner", "owner", "unique-long-password", secret, code, true); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := a.Pool.QueryRow(ctx, "SELECT totp_secret FROM staff WHERE username='owner'").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == secret || !strings.HasPrefix(stored, "v1:") {
		t.Fatal("plaintext secret")
	}
	decoded, err := security.OpenTOTP(a.TOTPKey, a.Dev, stored)
	if err != nil || decoded != secret {
		t.Fatal("encryption roundtrip", err)
	}
	a.TOTPKey = bytes.Repeat([]byte{8}, 32)
	if _, err = security.OpenTOTP(a.TOTPKey, a.Dev, stored); err == nil {
		t.Fatal("wrong key accepted")
	}
	if _, err = security.OpenTOTP(a.TOTPKey, a.Dev, DemoTOTP); err == nil {
		t.Fatal("production accepted plaintext")
	}
}
func TestCatalogModeAndBaseCategories(t *testing.T) {
	a := setup(t)
	a.CatalogOnly = true
	c := newClient(t, a.Handler())
	for _, path := range []string{"/checkout", "/checkout/quote", "/auth/request", "/auth/verify", "/orders/fake/simulate", "/webhooks/snapp", "/shipping/quote"} {
		if code, _ := c.call("POST", path, map[string]string{}); code != 503 {
			t.Fatalf("catalog bypass %s: %d", path, code)
		}
	}
	if code, _ := c.call("PUT", "/cart/items/turmeric", map[string]string{}); code != 503 {
		t.Fatal(code)
	}
	c.ok(t, "GET", "/categories", nil, nil)
	c.ok(t, "GET", "/products", nil, nil)
	owner := passwordStaff(t, a, "owner")
	for _, id := range []string{"spices", "herbs", "seeds"} {
		if code, _ := owner.call("DELETE", "/staff/categories/"+id, nil); code != 409 {
			t.Fatal("base category removed", code)
		}
	}
}

func TestFirstOwnerBootstrap(t *testing.T) {
	a := setup(t)
	a.Dev = false
	a.TOTPKey = bytes.Repeat([]byte{5}, 32)
	ctx := context.Background()
	if _, err := a.Pool.Exec(ctx, "TRUNCATE staff CASCADE"); err != nil {
		t.Fatal(err)
	}
	secret := security.NewTOTPSecret()
	if err := a.BootstrapOwner(ctx, "مالک", "merchant", "private-password-123", secret, security.TOTP(secret, time.Now().Unix()/30), false); err != nil {
		t.Fatal(err)
	}
	var role string
	if err := a.Pool.QueryRow(ctx, "SELECT role FROM staff WHERE username='merchant'").Scan(&role); err != nil || role != "owner" {
		t.Fatal(role, err)
	}
	if err := a.BootstrapOwner(ctx, "مالک", "another", "private-password-123", secret, security.TOTP(secret, time.Now().Unix()/30), false); err == nil {
		t.Fatal("second bootstrap succeeded")
	}
}

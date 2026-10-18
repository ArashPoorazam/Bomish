package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestPermissionOverrides(t *testing.T) {
	overrides := map[string]bool{"products": true, "products.create": true, "products.edit": false, "sales": false, "orders.edit": true}
	for _, role := range []string{"salesperson", "editor", "manager"} {
		got := effectivePermissions(role, nil, overrides)
		for key, want := range map[string]bool{"products": true, "products.create": true, "products.edit": false, "sales": false, "orders.edit": role == "manager"} {
			if slices.Contains(got, key) != want {
				t.Errorf("%s %s: %v", role, key, got)
			}
		}
	}
	if got := effectivePermissions("", nil, overrides); len(got) != 0 {
		t.Fatal("anonymous grant", got)
	}
	got := effectivePermissions("manager", []string{"requests", "products"})
	for _, key := range []string{"support", "custom", "home", "products", "products.edit"} {
		if slices.Contains(got, key) {
			t.Fatal("legacy restriction bypass", key)
		}
	}
	if !slices.Contains(effectivePermissions("owner", nil, map[string]bool{"members": false}), "members.edit") {
		t.Fatal("owner locked out")
	}
	if slices.Contains(effectivePermissions("salesperson", nil, map[string]bool{}), "products") {
		t.Fatal("reset did not restore defaults")
	}
	if validPermission("omnisire") || validPermission("unknown.edit") {
		t.Fatal("invalid override accepted")
	}
}

func TestPermissionActionEnforcement(t *testing.T) {
	a := &App{}
	hit := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }
	for _, tc := range []struct {
		method, action string
		want           int
	}{{"GET", "", 204}, {"PATCH", "", 403}, {"POST", "create", 403}, {"DELETE", "delete", 403}, {"POST", "view", 204}} {
		r := httptest.NewRequest(tc.method, "/", nil)
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, session{Permissions: []string{"products"}}))
		w := httptest.NewRecorder()
		if tc.action == "" {
			a.permit(hit, "products")(w, r)
		} else {
			a.permit(hit, "products", tc.action)(w, r)
		}
		if w.Code != tc.want {
			t.Fatalf("%s %s got %d", tc.method, tc.action, w.Code)
		}
	}
}

func TestMemberPermissionOverridesIntegration(t *testing.T) {
	a := setup(t)
	owner := couponOwner(t, a)
	body := map[string]any{"fullName": "آزمایش دسترسی", "username": "override-user", "phone": "09123456789", "bankCard": "5022291002696175", "role": "salesperson", "active": true, "password": "test-password-123", "restrictions": []string{}, "permissionOverrides": map[string]bool{"products": true, "products.create": true, "pricing": true, "pricing.edit": true, "sales": false, "support": true, "home": true, "categories": true, "categories.create": true}}
	var created map[string]string
	owner.ok(t, "POST", "/omnisire/members", body, &created)
	attach := func() *client {
		c := newClient(t, a.Handler())
		c.cookies[0].Name = "bomish_staff_session"
		if _, err := a.Pool.Exec(context.Background(), "UPDATE sessions SET staff_id=$1 WHERE token_hash=$2", created["id"], hash(c.cookies[0].Value)); err != nil {
			t.Fatal(err)
		}
		return c
	}
	c := attach()
	for _, path := range []string{"/staff/products", "/staff/requests?kind=support", "/staff/home/slides"} {
		c.ok(t, "GET", path, nil, nil)
	}
	for _, path := range []string{"/staff/sales", "/staff/requests?kind=custom", "/omnisire/members"} {
		if code, _ := c.call("GET", path, nil); code != 403 {
			t.Fatalf("view denial %s %d", path, code)
		}
	}
	if code, _ := c.call("PUT", "/staff/home/slides", map[string]any{}); code != 403 {
		t.Fatal("home write bypass", code)
	}
	var product domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	if code, _ := c.call("PUT", "/staff/products/turmeric", product); code != 403 {
		t.Fatal("create permission edited existing product", code)
	}
	product.ID = "permission-product"
	product.Slug = "permission-product"
	c.ok(t, "PUT", "/staff/products/permission-product", product, nil)
	c.ok(t, "PUT", "/staff/categories/permission-category", map[string]string{"name": "آزمایش"}, nil)
	if code, _ := c.call("PUT", "/staff/categories/permission-category", map[string]string{"name": "تغییر"}); code != 403 {
		t.Fatal("create permission edited category", code)
	}

	customer := newClient(t, a.Handler())
	customer.login(t, "09121118888")
	var chat, custom map[string]string
	customer.ok(t, "POST", "/requests", map[string]any{"kind": "support", "description": "پرسش آزمایشی", "idempotencyKey": "permission-support-01"}, &chat)
	customer.ok(t, "POST", "/requests", map[string]any{"kind": "custom", "description": "سفارش آزمایشی", "quantity": "۲ کیلو", "budgetRials": 1000000, "idempotencyKey": "permission-custom-001"}, &custom)
	c.ok(t, "GET", "/staff/requests/"+chat["id"], nil, nil)
	for _, suffix := range []string{"", "/messages", "/orders"} {
		if code, _ := c.call("GET", "/staff/requests/"+custom["id"]+suffix, nil); code != 403 {
			t.Fatal("cross-section request bypass", suffix, code)
		}
	}
	if code, _ := c.call("POST", "/staff/requests/"+chat["id"]+"/messages", map[string]string{"body": "denied", "idempotencyKey": "permission-message-01"}); code != 403 {
		t.Fatal("read-only reply bypass", code)
	}
	// Archive permission cannot modify content or require unrelated edit access.
	archiver, archiveID := testStaff(t, a, "salesperson", nil)
	if _, err := a.Pool.Exec(context.Background(), `UPDATE staff SET permission_overrides='{"articles":true,"articles.delete":true}'::jsonb WHERE id=$1`, archiveID); err != nil {
		t.Fatal(err)
	}
	var article domain.Article
	owner.ok(t, "GET", "/articles/spice-guide", nil, &article)
	title := article.Title
	article.Title = "unauthorized change"
	article.Status = "archived"
	archiver.ok(t, "PUT", "/staff/articles/"+article.ID, article, nil)
	var storedTitle, status string
	if err := a.Pool.QueryRow(context.Background(), "SELECT title,status FROM articles WHERE id=$1", article.ID).Scan(&storedTitle, &status); err != nil {
		t.Fatal(err)
	}
	if storedTitle != title || status != "archived" {
		t.Fatal("archive altered content", storedTitle, status)
	}
	// A role change must preserve overrides when the API field is omitted.
	delete(body, "permissionOverrides")
	body["role"] = "editor"
	owner.ok(t, "PATCH", "/omnisire/members/"+created["id"], body, nil)
	if code, _ := c.call("GET", "/staff/products", nil); code != 401 {
		t.Fatal("old session survived", code)
	}
	var member struct {
		Overrides map[string]bool `json:"permissionOverrides"`
	}
	owner.ok(t, "GET", "/omnisire/members/"+created["id"], nil, &member)
	if member.Overrides["products"] != true || member.Overrides["sales"] != false || len(member.Overrides) == 0 {
		t.Fatal("overrides lost", member)
	}
	c = attach()
	if code, _ := c.call("GET", "/staff/sales", nil); code != 403 {
		t.Fatal("role change lost denial", code)
	}
	body["permissionOverrides"] = map[string]bool{}
	owner.ok(t, "PATCH", "/omnisire/members/"+created["id"], body, nil)
	c = attach()
	c.ok(t, "GET", "/staff/sales", nil, nil)
	member.Overrides = nil
	owner.ok(t, "GET", "/omnisire/members/"+created["id"], nil, &member)
	if len(member.Overrides) != 0 {
		raw, _ := json.Marshal(member)
		t.Fatal("reset failed", string(raw))
	}
	body["permissionOverrides"] = map[string]bool{"omnisire": true}
	if code, _ := owner.call("PATCH", "/omnisire/members/"+created["id"], body); code != 400 {
		t.Fatal("unknown override accepted", code)
	}
}

package access

import (
	"slices"
	"testing"
)

func TestPermissionOverrides(t *testing.T) {
	overrides := map[string]bool{"products": true, "products.create": true, "products.edit": false, "sales": false, "orders.edit": true}
	for _, role := range []string{"salesperson", "editor", "manager"} {
		got := Effective(role, nil, overrides)
		for key, want := range map[string]bool{"products": true, "products.create": true, "products.edit": false, "sales": false, "orders.edit": role == "manager"} {
			if slices.Contains(got, key) != want {
				t.Errorf("%s %s: %v", role, key, got)
			}
		}
	}
	if got := Effective("", nil, overrides); len(got) != 0 {
		t.Fatal("anonymous grant", got)
	}
	got := Effective("manager", []string{"requests", "products"})
	for _, key := range []string{"support", "custom", "home", "products", "products.edit", "packaging", "packaging.edit"} {
		if slices.Contains(got, key) {
			t.Fatal("legacy restriction bypass", key)
		}
	}
	if !slices.Contains(Effective("owner", nil, map[string]bool{"members": false}), "members.edit") {
		t.Fatal("owner locked out")
	}
	if slices.Contains(Effective("salesperson", nil, map[string]bool{}), "products") {
		t.Fatal("reset did not restore defaults")
	}
	if Valid("omnisire") || Valid("unknown.edit") {
		t.Fatal("invalid override accepted")
	}
}

func TestAssignablePermissionMatrix(t *testing.T) {
	for _, section := range Sections() {
		t.Run(section.Key, func(t *testing.T) {
			keys := []string{section.Key}
			for _, action := range section.Actions {
				keys = append(keys, section.Key+"."+action)
			}
			grants := map[string]bool{}
			for _, key := range keys {
				grants[key] = true
				if Valid(key) == section.OwnerOnly {
					t.Fatalf("incorrect assignability for %s", key)
				}
			}
			for role := range Roles() {
				got := Effective(role, nil, grants)
				for _, key := range keys {
					if slices.Contains(got, key) == section.OwnerOnly {
						t.Fatalf("%s grant %s: %v", role, key, got)
					}
				}
				grants[section.Key] = false
				got = Effective(role, nil, grants)
				for _, key := range keys {
					if slices.Contains(got, key) {
						t.Fatalf("%s section denial left %s enabled", role, key)
					}
				}
				grants[section.Key] = true
			}
		})
	}
}

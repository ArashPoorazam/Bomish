package app

import (
	"context"
	"encoding/json"
	"testing"

	"bomish/internal/security"
)

func TestMonitoringOwnerAndVerification(t *testing.T) {
	a := setup(t)
	owner, _ := testStaff(t, a, "owner", nil)
	for _, role := range []string{"manager", "editor", "operator", "salesperson"} {
		staff, _ := testStaff(t, a, role, nil)
		if code, _ := staff.call("GET", "/omnisire/monitoring", nil); code != 403 {
			t.Fatalf("%s got %d", role, code)
		}
	}
	if code, _ := newClient(t, a.Handler()).call("GET", "/omnisire/monitoring", nil); code != 403 {
		t.Fatalf("anonymous got %d", code)
	}
	code, raw := owner.call("GET", "/omnisire/monitoring", nil)
	var snapshot struct {
		Status   string `json:"status"`
		Database struct {
			Status string `json:"status"`
			Max    int    `json:"maxConnections"`
		} `json:"database"`
		Runtime struct {
			Heap uint64 `json:"heapBytes"`
		} `json:"runtime"`
		Traffic   []any            `json:"traffic"`
		Resources []resourceSample `json:"resources"`
	}
	if code != 200 || json.Unmarshal(raw, &snapshot) != nil || snapshot.Database.Status != "healthy" || snapshot.Database.Max == 0 || snapshot.Runtime.Heap == 0 || len(snapshot.Traffic) == 0 {
		t.Fatalf("invalid snapshot: %d %s", code, raw)
	}
	if len(snapshot.Resources) != 1 || snapshot.Resources[0].At.IsZero() || snapshot.Resources[0].ConnectionsPercent == nil {
		t.Fatalf("missing resource sample: %s", raw)
	}
	_, err := a.Pool.Exec(context.Background(), "UPDATE sessions SET omnisire_verified=false WHERE token_hash=$1", security.Hash(owner.cookies[0].Value))
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := owner.call("GET", "/omnisire/monitoring", nil); code != 428 {
		t.Fatalf("unverified owner got %d", code)
	}
}

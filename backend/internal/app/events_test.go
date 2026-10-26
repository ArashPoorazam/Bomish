package app

import (
	"context"
	"fmt"
	"testing"
)

func TestAuditLogFiltersSummaryAndPagination(t *testing.T) {
	a := setup(t)
	owner, id := testStaff(t, a, "owner", nil)
	ctx := context.Background()
	for i := 0; i < 32; i++ {
		action := "product.publish"
		var actor any = id
		if i%4 == 0 {
			action = "auth.failed"
			actor = nil
		}
		_, err := a.Pool.Exec(ctx, `INSERT INTO audit_events(staff_id,action,entity_id,detail,created_at) VALUES($1,$2,$3,jsonb_build_object('requestId',$4::text),'2026-10-25T12:00:00Z'::timestamptz+($5::int*interval '1 minute'))`, actor, action, fmt.Sprintf("audit-fixture-%02d", i), fmt.Sprintf("audit-request-%02d", i), i)
		if err != nil {
			t.Fatal(err)
		}
	}
	type result struct {
		Items []struct {
			Action   string `json:"action"`
			Entity   string `json:"entityId"`
			Category string `json:"category"`
			Review   bool   `json:"reviewSignal"`
		} `json:"items"`
		Total   int `json:"total"`
		Page    int `json:"page"`
		Summary struct {
			Actors       int `json:"actors"`
			Unattributed int `json:"unattributed"`
			Review       int `json:"review"`
		} `json:"summary"`
	}
	var all result
	owner.ok(t, "GET", "/omnisire/events?q=audit-fixture&from=2026-10-25&to=2026-10-25", nil, &all)
	if all.Total != 32 || len(all.Items) != 25 || all.Summary.Actors != 1 || all.Summary.Unattributed != 8 || all.Summary.Review != 8 {
		t.Fatalf("wrong complete-result summary: %+v", all)
	}
	cases := []struct {
		query       string
		total, page int
		first       string
	}{
		{"&category=catalog", 24, 1, "audit-fixture-31"},
		{"&review=true", 8, 1, "audit-fixture-28"},
		{"&actor=" + id, 24, 1, "audit-fixture-31"},
		{"&action=auth.failed", 8, 1, "audit-fixture-28"},
		{"&entity=audit-fixture-03", 1, 1, "audit-fixture-03"},
		{"&sort=oldest&pageSize=10&page=2", 32, 2, "audit-fixture-10"},
		{"&page=999", 32, 2, "audit-fixture-06"},
		{"&category=finance", 0, 1, ""},
	}
	for _, c := range cases {
		var got result
		owner.ok(t, "GET", "/omnisire/events?q=audit-fixture"+c.query, nil, &got)
		if got.Total != c.total || got.Page != c.page || (c.first != "" && (len(got.Items) == 0 || got.Items[0].Entity != c.first)) {
			t.Fatalf("%s: %+v", c.query, got)
		}
	}
	var exact result
	owner.ok(t, "GET", "/omnisire/events?q=audit-request-03", nil, &exact)
	if exact.Total != 1 || exact.Items[0].Entity != "audit-fixture-03" {
		t.Fatal("request ID search failed")
	}
	for _, q := range []string{"from=invalid", "from=2026-10-26&to=2026-10-25", "category=bogus", "review=bogus"} {
		if code, _ := owner.call("GET", "/omnisire/events?"+q, nil); code != 400 {
			t.Fatalf("%s accepted: %d", q, code)
		}
	}
	staff, _ := testStaff(t, a, "manager", nil)
	if code, _ := staff.call("GET", "/omnisire/events", nil); code != 403 {
		t.Fatalf("staff access: %d", code)
	}
	// Tehran midnight is 20:30 UTC; the end date is inclusive in local time.
	_, err := a.Pool.Exec(ctx, `INSERT INTO audit_events(action,entity_id,created_at) VALUES('export.ready','audit-boundary-before','2026-10-25T20:29:59Z'),('export.ready','audit-boundary-after','2026-10-25T20:30:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	var boundary result
	owner.ok(t, "GET", "/omnisire/events?q=audit-boundary&from=2026-10-25&to=2026-10-25", nil, &boundary)
	if boundary.Total != 1 || boundary.Items[0].Entity != "audit-boundary-before" {
		t.Fatalf("wrong Tehran boundary: %+v", boundary)
	}
}

package app

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

func TestStaffRequestFiltersPaginationAndDetails(t *testing.T) {
	a := setup(t)
	customer := newClient(t, a.Handler())
	customer.login(t, "09125550001")
	staff, _ := testStaff(t, a, "operator", nil)
	restricted, _ := testStaff(t, a, "operator", []string{"requests"})
	var firstID string
	for i := 0; i < 7; i++ {
		var created map[string]string
		customer.ok(t, "POST", "/requests", map[string]any{"kind": "custom", "description": fmt.Sprintf("ترکیب ویژه %d", i), "quantity": "۲ کیلو", "budgetRials": 1000000, "idempotencyKey": fmt.Sprintf("filtered-custom-%03d", i)}, &created)
		if i == 0 {
			firstID = created["id"]
		}
		if i < 4 {
			staff.ok(t, "PATCH", "/staff/requests/"+created["id"], map[string]any{"status": "accepted", "response": "تأیید شد", "version": 1}, nil)
		}
	}
	var page struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	staff.ok(t, "GET", "/staff/requests?kind=custom&status=accepted&q="+url.QueryEscape("ترکیب ویژه")+"&page=2&pageSize=2", nil, &page)
	if page.Total != 4 || len(page.Items) != 2 {
		t.Fatalf("filtered page: %+v", page)
	}
	for _, item := range page.Items {
		if item["status"] != "accepted" {
			t.Fatal(item)
		}
	}
	staff.ok(t, "GET", "/staff/requests?kind=custom&q=09125550001&page=1", nil, &page)
	if page.Total != 7 {
		t.Fatal("phone search", page.Total)
	}
	staff.ok(t, "GET", "/staff/requests?kind=custom&q=%25&page=1", nil, &page)
	if page.Total != 0 {
		t.Fatal("search wildcard was not escaped", page.Total)
	}
	for _, suffix := range []string{"kind=support&status=accepted", "kind=custom&status=unknown", "kind=custom&unread=invalid", "kind=custom&q=" + strings.Repeat("x", 201)} {
		if code, _ := staff.call("GET", "/staff/requests?"+suffix, nil); code != 400 {
			t.Fatal(suffix, code)
		}
	}
	var detail map[string]any
	staff.ok(t, "GET", "/staff/requests/"+firstID, nil, &detail)
	if detail["version"] != float64(2) || detail["status"] != "accepted" {
		t.Fatal(detail)
	}
	if code, _ := restricted.call("GET", "/staff/requests/"+firstID, nil); code != 403 {
		t.Fatal("detail permissions", code)
	}
	if code, _ := customer.call("GET", "/staff/requests/"+firstID, nil); code != 403 {
		t.Fatal("staff detail exposed to customer", code)
	}
	if code, _ := staff.call("GET", "/staff/requests/missing", nil); code != 404 {
		t.Fatal(code)
	}
}

func TestStaffRequestUnreadAndLatestPreview(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09125550002")
	staff, _ := testStaff(t, a, "operator", nil)
	other, _ := testStaff(t, a, "manager", nil)
	var created map[string]string
	c.ok(t, "POST", "/requests", map[string]any{"kind": "support", "description": "پیام نخست", "idempotencyKey": "preview-support-001"}, &created)
	id := created["id"]
	body := strings.Repeat("پ", 160)
	var last map[string]any
	c.ok(t, "POST", "/requests/"+id+"/messages", map[string]string{"body": body, "idempotencyKey": "preview-message-001"}, &last)
	var page struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	staff.ok(t, "GET", "/staff/requests?kind=support&unread=true&page=1", nil, &page)
	if page.Total != 1 || page.Items[0]["latestMessage"] != strings.Repeat("پ", 140) {
		t.Fatal(page)
	}
	staff.ok(t, "POST", "/staff/requests/"+id+"/read", map[string]any{"lastMessageId": last["id"]}, nil)
	staff.ok(t, "GET", "/staff/requests?kind=support&unread=true&page=1", nil, &page)
	if page.Total != 0 {
		t.Fatal("read conversation remains unread", page)
	}
	other.ok(t, "GET", "/staff/requests?kind=support&unread=true&page=1", nil, &page)
	if page.Total != 1 {
		t.Fatal("read state leaked across staff", page)
	}
	staff.ok(t, "POST", "/staff/requests/"+id+"/messages", map[string]string{"body": "پاسخ پشتیبانی", "idempotencyKey": "preview-staff-reply"}, nil)
	staff.ok(t, "GET", "/staff/requests?kind=support&unread=false&page=1", nil, &page)
	if page.Total != 1 || page.Items[0]["latestMessage"] != "پاسخ پشتیبانی" {
		t.Fatal(page)
	}
}

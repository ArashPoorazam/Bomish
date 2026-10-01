package app

import (
	"context"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestHomeSlidesPersistencePermissionsAndValidation(t *testing.T) {
	a := setup(t)
	h := a.Handler()
	anonymous := httptest.NewRecorder()
	h.ServeHTTP(anonymous, httptest.NewRequest("GET", "/api/v1/home/slides", nil))
	if anonymous.Code != 200 || len(anonymous.Result().Cookies()) != 0 {
		t.Fatal("public slides must not allocate a session", anonymous.Code)
	}
	c := newClient(t, h)
	var initial []homeSlide
	c.ok(t, "GET", "/home/slides", nil, &initial)
	if len(initial) != 1 || initial[0].Image != "/images/spices.png" {
		t.Fatal("missing initial homepage picture", initial)
	}
	editor, _ := testStaff(t, a, "editor", nil)
	operator, _ := testStaff(t, a, "operator", nil)
	restricted, _ := testStaff(t, a, "editor", []string{"products"})
	slides := []homeSlide{{Image: "/images/spices.png", Alt: " ادویه‌ها "}, {Image: "/uploads/example.webp", Alt: "سبزی‌های خشک"}}
	for _, client := range []*client{c, operator, restricted} {
		for _, method := range []string{"GET", "PUT"} {
			code, _ := client.call(method, "/staff/home/slides", slides)
			if code != 401 && code != 403 {
				t.Fatalf("unauthorized %s: %d", method, code)
			}
		}
	}
	editor.ok(t, "PUT", "/staff/home/slides", slides, nil)
	slides[0].Alt = strings.TrimSpace(slides[0].Alt)
	var got []homeSlide
	c.ok(t, "GET", "/home/slides", nil, &got)
	if !reflect.DeepEqual(got, slides) {
		t.Fatalf("persistence: %#v", got)
	}
	invalid := []any{nil, map[string]any{"slides": slides}, []homeSlide{{Image: "https://example.com/image.jpg", Alt: "عکس"}}, []homeSlide{{Image: "/uploads/../private.png", Alt: "عکس"}}, []homeSlide{{Image: "/images/spices.png", Alt: " "}}, []homeSlide{{Image: "/images/spices.png", Alt: strings.Repeat("ن", 301)}}, []homeSlide{{Image: "/images/spices.png", Alt: "a\x00b"}}}
	for _, value := range invalid {
		if code, _ := editor.call("PUT", "/staff/home/slides", value); code != 400 {
			t.Fatalf("invalid input accepted: %d %#v", code, value)
		}
		c.ok(t, "GET", "/home/slides", nil, &got)
		if !reflect.DeepEqual(got, slides) {
			t.Fatal("invalid save destroyed existing slides")
		}
	}
	csrf := editor.csrf
	editor.csrf = "bad"
	if code, _ := editor.call("PUT", "/staff/home/slides", []homeSlide{}); code != 403 {
		t.Fatal("missing CSRF enforcement", code)
	}
	editor.csrf = csrf
	slides[0], slides[1] = slides[1], slides[0]
	editor.ok(t, "PUT", "/staff/home/slides", slides, nil)
	editor.ok(t, "GET", "/staff/home/slides", nil, &got)
	if !reflect.DeepEqual(got, slides) {
		t.Fatal("order not saved")
	}
	editor.ok(t, "PUT", "/staff/home/slides", []homeSlide{}, nil)
	c.ok(t, "GET", "/home/slides", nil, &got)
	if got == nil || len(got) != 0 {
		t.Fatal("empty slides must serialize as []", got)
	}
	var count int
	if err := a.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE action='store.home_slides'`).Scan(&count); err != nil || count != 3 {
		t.Fatal("audit missing", count, err)
	}
}

func TestSuggestionPreviewAndRetainedUnavailableSelection(t *testing.T) {
	a := setup(t)
	owner, _ := testStaff(t, a, "owner", nil)
	owner.ok(t, "PUT", "/staff/suggestions", map[string]any{"productIds": []string{"turmeric", "mint"}}, nil)
	for _, ids := range [][]string{{"mint", "mint"}, strings.Split(strings.Repeat("mint,", 12)+"turmeric", ",")} {
		if code, _ := owner.call("PUT", "/staff/suggestions", map[string]any{"productIds": ids}); code != 400 {
			t.Fatal("duplicate or oversized selection accepted", code)
		}
	}

	if _, err := a.Pool.Exec(context.Background(), `UPDATE products SET status='draft', content=jsonb_set(content,'{outOfStock}','true') WHERE id='turmeric'`); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "PUT", "/staff/suggestions", map[string]any{"productIds": []string{"mint", "turmeric"}}, nil)
	var picks []struct {
		ID         string `json:"id"`
		Image      string `json:"image"`
		OutOfStock bool   `json:"outOfStock"`
	}
	owner.ok(t, "GET", "/staff/suggestions", nil, &picks)
	if len(picks) != 2 || picks[1].ID != "turmeric" || !picks[1].OutOfStock || picks[1].Image == "" {
		t.Fatal("preview missing", picks)
	}
	owner.ok(t, "PUT", "/staff/suggestions", map[string]any{"productIds": []string{"mint"}}, nil)
	if code, _ := owner.call("PUT", "/staff/suggestions", map[string]any{"productIds": []string{"turmeric"}}); code != 400 {
		t.Fatal("new draft selection accepted", code)
	}
}

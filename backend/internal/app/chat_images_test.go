package app

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestDecodeChatImage(t *testing.T) {
	for _, tt := range []struct {
		name  string
		data  []byte
		valid bool
	}{
		{"png", append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...), true},
		{"html", []byte("<html><script>alert(1)</script></html>"), false},
		{"empty", nil, false},
		{"oversize", make([]byte, chatImageLimit+1), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var body bytes.Buffer
			mw := multipart.NewWriter(&body)
			mw.WriteField("payload", `{"body":"caption"}`)
			part, _ := mw.CreateFormFile("image", "photo.png")
			part.Write(tt.data)
			mw.Close()
			req := httptest.NewRequest("POST", "/", &body)
			req.Header.Set("Content-Type", mw.FormDataContentType())
			var payload struct {
				Body string `json:"body"`
			}
			image, ok := decodeChat(httptest.NewRecorder(), req, &payload)
			if ok != tt.valid {
				t.Fatalf("valid=%v, want %v", ok, tt.valid)
			}
			if ok && (!bytes.Equal(image, tt.data) || payload.Body != "caption") {
				t.Fatal("lost image or caption")
			}
		})
	}
}

func TestChatPicturesPrivateAndIdempotent(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09121112220")
	other := newClient(t, a.Handler())
	other.login(t, "09121112221")
	staff, _ := testStaff(t, a, "operator", nil)
	picture := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)
	send := func(c *client, path, payload string, data []byte) (int, []byte) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		mw.WriteField("payload", payload)
		part, _ := mw.CreateFormFile("image", "photo.png")
		part.Write(data)
		mw.Close()
		req := httptest.NewRequest("POST", "http://bomish.test/api/v1"+path, &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Origin", "http://bomish.test")
		req.Header.Set("X-CSRF-Token", c.csrf)
		for _, cookie := range c.cookies {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		c.h.ServeHTTP(w, req)
		return w.Code, w.Body.Bytes()
	}
	payload := `{"kind":"support","description":"","idempotencyKey":"picture-initial-0001"}`
	code, raw := send(c, "/requests", payload, picture)
	if code != 201 {
		t.Fatalf("create: %d %s", code, raw)
	}
	var created map[string]string
	json.Unmarshal(raw, &created)
	id := created["id"]
	if code, _ = send(c, "/requests", payload, picture); code != 201 {
		t.Fatal("retry", code)
	}
	changed := append(append([]byte{}, picture...), 1)
	if code, _ = send(c, "/requests", payload, changed); code != 409 {
		t.Fatal("changed image reused key", code)
	}
	var messages []struct {
		ID       int64 `json:"id"`
		HasImage bool  `json:"hasImage"`
	}
	c.ok(t, "GET", "/requests/"+id+"/messages", nil, &messages)
	if len(messages) != 1 || !messages[0].HasImage {
		t.Fatal(messages)
	}
	path := "/requests/" + id + "/messages/" + strconv.FormatInt(messages[0].ID, 10) + "/image"
	if code, raw = c.call("GET", path, nil); code != 200 || !bytes.Equal(raw, picture) {
		t.Fatal("picture roundtrip", code)
	}
	if code, _ = other.call("GET", path, nil); code != 404 {
		t.Fatal("picture leaked", code)
	}
	if code, raw = staff.call("GET", "/staff"+path, nil); code != 200 || !bytes.Equal(raw, picture) {
		t.Fatal("staff picture access", code)
	}
	if code, _ = send(staff, "/staff/requests/"+id+"/messages", `{"body":"","idempotencyKey":"staff-picture-00001"}`, picture); code != 201 {
		t.Fatal("staff send", code)
	}
	ctx := context.Background()
	_, err := a.Pool.Exec(ctx, `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) SELECT 'chat-order-'||u.id,u.id,'chat-order','cancelled','{"phone":"09999999999"}',1000,0,1000,now() FROM users u WHERE phone IN ('09121112220','09121112221')`)
	if err != nil {
		t.Fatal(err)
	}
	var orders struct {
		Total int              `json:"total"`
		Items []map[string]any `json:"items"`
	}
	staff.ok(t, "GET", "/staff/requests/"+id+"/orders?page=1&pageSize=20", nil, &orders)
	if orders.Total != 1 || len(orders.Items) != 1 {
		t.Fatalf("wrong customer history: %+v", orders)
	}
	if code, _ = c.call("GET", "/staff/requests/"+id+"/orders", nil); code != 401 && code != 403 {
		t.Fatal("customer accessed staff history", code)
	}
}

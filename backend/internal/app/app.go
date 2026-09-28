package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"bomish/internal/db"
	"bomish/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	Pool    *pgxpool.Pool
	Queries *db.Queries
	Dev     bool
	Origin  string
	Uploads storage.Store
}
type session struct {
	Hash, CSRF, UserID, StaffID, Role string
	Permissions                       []string
}
type sessionKey struct{}

func token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func hash(s string) string            { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func current(r *http.Request) session { v, _ := r.Context().Value(sessionKey{}).(session); return v }
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	write(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "اطلاعات ارسالی معتبر نیست")
		return false
	}
	return true
}
func (a *App) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if e := a.Pool.Ping(r.Context()); e != nil {
			fail(w, 503, "پایگاه داده در دسترس نیست")
			return
		}
		write(w, 200, map[string]string{"status": "ok"})
	})
	m.HandleFunc("GET /api/v1/settings", a.publicSettings)
	m.HandleFunc("GET /api/v1/addresses/reverse", a.reverseAddress)
	m.HandleFunc("GET /api/v1/orders/{id}", a.getOrder)
	m.HandleFunc("POST /api/v1/events", a.recordEvent)
	m.HandleFunc("GET /api/v1/staff/product-discounts", a.permit(a.listProductDiscounts, "pricing"))
	m.HandleFunc("POST /api/v1/staff/product-discounts", a.permit(a.createProductDiscount, "pricing"))
	m.HandleFunc("PATCH /api/v1/staff/product-discounts/{id}", a.permit(a.changeProductDiscount, "pricing"))
	m.HandleFunc("DELETE /api/v1/staff/product-discounts/{id}", a.permit(a.changeProductDiscount, "pricing"))
	m.HandleFunc("DELETE /api/v1/staff/discount-codes/{code}", a.permit(a.deleteDiscountCode, "pricing"))
	m.HandleFunc("POST /api/v1/staff/pricing", a.permit(a.adjustPrices, "pricing"))
	m.HandleFunc("GET /api/v1/staff/discount-codes", a.permit(a.listDiscountCodes, "pricing"))
	m.HandleFunc("POST /api/v1/staff/discount-codes", a.permit(a.createDiscountCode, "pricing"))
	m.HandleFunc("PATCH /api/v1/staff/discount-codes/{code}", a.permit(a.toggleDiscountCode, "pricing"))
	m.HandleFunc("DELETE /api/v1/staff/categories/{id}", a.permit(a.deleteCategory, "categories"))
	m.HandleFunc("GET /api/v1/session", a.sessionInfo)
	m.HandleFunc("POST /api/v1/logout", a.logout)
	m.HandleFunc("POST /api/v1/auth/request", a.requestOTP)
	m.HandleFunc("POST /api/v1/auth/verify", a.verifyOTP)
	m.HandleFunc("POST /api/v1/staff/login", a.staffLogin)
	m.HandleFunc("GET /api/v1/categories", a.categories)
	m.HandleFunc("GET /api/v1/products", a.products)
	m.HandleFunc("GET /api/v1/products/{slug}", a.product)
	m.HandleFunc("GET /api/v1/articles", a.articles)
	m.HandleFunc("GET /api/v1/articles/{slug}", a.article)
	m.HandleFunc("GET /api/v1/cart", a.getCart)
	m.HandleFunc("PUT /api/v1/cart/items/{id}", a.setCartItem)
	m.HandleFunc("DELETE /api/v1/cart/items/{id}", a.removeCartItem)
	m.HandleFunc("GET /api/v1/addresses", a.addresses)
	m.HandleFunc("POST /api/v1/addresses", a.saveAddress)
	m.HandleFunc("POST /api/v1/checkout/quote", a.quote)
	m.HandleFunc("POST /api/v1/checkout", a.checkout)
	m.HandleFunc("GET /api/v1/orders", a.orders)
	m.HandleFunc("POST /api/v1/orders/{id}/simulate", a.simulatePayment)
	m.HandleFunc("GET /api/v1/staff/products", a.permit(a.staffProducts, "products"))
	m.HandleFunc("PUT /api/v1/staff/products/{id}", a.permit(a.saveProduct, "products"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/publish", a.permit(a.publishProduct, "products"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/archive", a.permit(a.archiveProduct, "products"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/availability", a.permit(a.setAvailability, "products"))
	m.HandleFunc("PUT /api/v1/staff/categories/{id}", a.permit(a.saveCategory, "categories"))
	m.HandleFunc("GET /api/v1/staff/articles", a.permit(a.staffArticles, "articles"))
	m.HandleFunc("PUT /api/v1/staff/articles/{id}", a.permit(a.saveArticle, "articles"))
	m.HandleFunc("GET /api/v1/staff/orders", a.permit(a.staffOrders, "orders"))
	m.HandleFunc("GET /api/v1/staff/orders/{id}", a.permit(a.staffOrder, "orders"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}/packing", a.permit(a.packOrderItem, "orders"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}", a.permit(a.updateOrder, "orders"))
	m.HandleFunc("GET /api/v1/staff/shipping", a.permit(a.shippingSettings, "shipping"))
	m.HandleFunc("PUT /api/v1/staff/shipping", a.permit(a.saveShipping, "shipping"))
	m.HandleFunc("POST /api/v1/staff/uploads", a.permitAny(a.upload, "products", "articles"))
	m.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(os.Getenv("UPLOAD_DIR")))))
	a.omnisireRoutes(m)
	return a.middleware(m)
}
func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if e := recover(); e != nil {
				slog.Error("request panic", "error", e)
				fail(w, 500, "خطایی رخ داد؛ دوباره تلاش کنید")
			}
		}()
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		// Public catalog reads do not allocate anonymous sessions (including SSR fetches).
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			path := r.URL.Path
			if path == "/api/v1/health" || path == "/api/v1/categories" || path == "/api/v1/products" || strings.HasPrefix(path, "/api/v1/products/") || path == "/api/v1/articles" || strings.HasPrefix(path, "/api/v1/articles/") {
				next.ServeHTTP(w, r)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		s := session{}
		var restrictions []string
		if c, e := r.Cookie("bomish_session"); e == nil {
			s.Hash = hash(c.Value)
			e = a.Pool.QueryRow(ctx, `SELECT s.csrf,coalesce(s.user_id,''),coalesce(s.staff_id,''),coalesce(t.role,''),coalesce(t.restrictions,'{}') FROM sessions s LEFT JOIN staff t ON t.id=s.staff_id AND t.active AND t.archived_at IS NULL WHERE s.token_hash=$1 AND s.expires_at>now()`, s.Hash).Scan(&s.CSRF, &s.UserID, &s.StaffID, &s.Role, &restrictions)
			if e != nil {
				s = session{}
			}
		}
		s.Permissions = effectivePermissions(s.Role, restrictions)
		if s.Role == "" {
			s.StaffID = ""
		}
		if s.Hash == "" {
			raw := token()
			s = session{Hash: hash(raw), CSRF: token()}
			if _, e := a.Pool.Exec(ctx, "INSERT INTO sessions(token_hash,csrf,expires_at) VALUES($1,$2,now()+interval '30 days')", s.Hash, s.CSRF); e != nil {
				fail(w, 503, "سرویس موقتاً در دسترس نیست")
				return
			}
			a.cookie(w, raw)
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.Origin || r.Header.Get("X-CSRF-Token") != s.CSRF {
				fail(w, 403, "درخواست نامعتبر است؛ صفحه را تازه کنید")
				return
			}
		}
		s.Permissions = effectivePermissions(s.Role, restrictions)
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, sessionKey{}, s)))
	})
}
func (a *App) cookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{Name: "bomish_session", Value: value, Path: "/", HttpOnly: true, Secure: !a.Dev || strings.HasPrefix(a.Origin, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: 30 * 86400})
}
func (a *App) sessionInfo(w http.ResponseWriter, r *http.Request) {
	s := current(r)
	write(w, 200, map[string]any{"csrf": s.CSRF, "authenticated": s.UserID != "", "role": s.Role, "staffId": s.StaffID, "permissions": s.Permissions, "development": a.Dev})
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	a.logEvent(r.Context(), current(r).StaffID, "auth.logout", current(r).StaffID, map[string]string{})
	_, e := a.Pool.Exec(r.Context(), "UPDATE sessions SET user_id=NULL,staff_id=NULL WHERE token_hash=$1", current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) dbError(w http.ResponseWriter, e error) {
	slog.Error("database operation failed", "error", e)
	fail(w, 500, "ذخیره یا دریافت اطلاعات انجام نشد")
}
func requireCustomer(w http.ResponseWriter, r *http.Request) bool {
	if current(r).UserID == "" {
		fail(w, 401, "برای ادامه وارد حساب شوید")
		return false
	}
	return true
}

var errUnavailable = errors.New("وضعیت محصول، بسته یا سقف خرید تغییر کرده است؛ سبد را بررسی کنید")

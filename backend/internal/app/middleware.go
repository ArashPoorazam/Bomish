package app

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"bomish/internal/access"
	"bomish/internal/httpx"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if e := recover(); e != nil {
				slog.Error("request panic", "request_id", httpx.RequestID(r.Context()))
				httpx.Error(w, 500, "خطایی رخ داد؛ دوباره تلاش کنید")
			}
		}()
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		if a.CatalogOnly && catalogBlocked(r) {
			httpx.Error(w, 503, "فروش آنلاین هنوز آغاز نشده است؛ در حال حاضر می‌توانید محصولات را مشاهده کنید.")
			return
		}
		if r.URL.Path == "/api/v1/webhooks/snapp" {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		// Public catalog reads do not allocate anonymous sessions (including SSR fetches).
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			path := r.URL.Path
			if path == "/api/v1/home/slides" || path == "/api/v1/health" || path == "/api/v1/settings" || path == "/api/v1/categories" || path == "/api/v1/products" || strings.HasPrefix(path, "/api/v1/products/") || path == "/api/v1/articles" || strings.HasPrefix(path, "/api/v1/articles/") {
				next.ServeHTTP(w, r)
				return
			}
		}
		s := session{}
		var restrictions []string
		var overrides map[string]bool
		if c, e := r.Cookie(sessionCookieName(r)); e == nil {
			s.Hash = security.Hash(c.Value)
			e = a.Pool.QueryRow(ctx, `SELECT s.csrf,coalesce(s.user_id,''),coalesce(s.staff_id,''),coalesce(t.role,''),coalesce(t.restrictions,'{}'),coalesce(t.permission_overrides,'{}'::jsonb),s.omnisire_verified FROM sessions s LEFT JOIN staff t ON t.id=s.staff_id AND t.active AND t.archived_at IS NULL WHERE s.token_hash=$1 AND s.expires_at>now()`, s.Hash).Scan(&s.CSRF, &s.UserID, &s.StaffID, &s.Role, &restrictions, &overrides, &s.OmnisireVerified)
			if e == pgx.ErrNoRows {
				// Never replace a cookie on an ordinary in-flight request: it may
				// carry the token just rotated by a concurrent login.
				if r.URL.Path != "/api/v1/session" {
					httpx.Error(w, 401, "نشست منقضی شده است؛ دوباره وارد شوید")
					return
				}
				s = session{}
			} else if e != nil {
				httpx.Error(w, 503, "سرویس موقتاً در دسترس نیست؛ دوباره تلاش کنید")
				return
			}
		}
		if sessionCookieName(r) == "bomish_staff_session" {
			s.UserID = ""
		} else {
			s.StaffID = ""
			s.Role = ""
		}
		if s.Role == "" {
			s.StaffID = ""
		}
		if s.Hash == "" {
			raw := security.Token()
			s = session{Hash: security.Hash(raw), CSRF: security.Token()}
			if _, e := a.Pool.Exec(ctx, "INSERT INTO sessions(token_hash,csrf,expires_at) VALUES($1,$2,now()+interval '30 days')", s.Hash, s.CSRF); e != nil {
				httpx.Error(w, 503, "سرویس موقتاً در دسترس نیست")
				return
			}
			a.cookie(w, r, raw)
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.Origin || r.Header.Get("X-CSRF-Token") != s.CSRF {
				httpx.Error(w, 403, "درخواست نامعتبر است؛ صفحه را تازه کنید")
				return
			}
		}
		s.Permissions = access.Effective(s.Role, restrictions, overrides)
		if strings.HasPrefix(r.URL.Path, "/api/v1/omnisire/") {
			if s.Role != "owner" {
				httpx.Error(w, 403, "این بخش فقط برای مالک است")
				return
			}
			if r.URL.Path != "/api/v1/omnisire/unlock" && !s.OmnisireVerified {
				httpx.Error(w, 428, "برای ورود به امنی‌سایر کد برنامه رمزساز را وارد کنید")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, sessionKey{}, s)))
	})
}

func catalogBlocked(r *http.Request) bool {
	p := r.URL.Path
	return strings.HasPrefix(p, "/api/v1/checkout") || strings.HasPrefix(p, "/api/v1/auth/") ||
		strings.HasPrefix(p, "/api/v1/webhooks/") || strings.HasPrefix(p, "/api/v1/shipping/") ||
		(strings.HasPrefix(p, "/api/v1/orders/") && strings.HasSuffix(p, "/simulate")) ||
		(strings.HasPrefix(p, "/api/v1/cart/items/") && r.Method != "GET" && r.Method != "HEAD")
}

package httpx

import (
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestTrustedProxyChain(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("172.30.0.0/24"), netip.MustParsePrefix("203.0.113.0/24")}
	for _, test := range []struct{ peer, forwarded, want string }{
		{"198.51.100.4:5555", "1.2.3.4", "198.51.100.4"},
		{"172.30.0.2:5555", "1.2.3.4, 198.51.100.4, 203.0.113.4", "198.51.100.4"},
		{"172.30.0.2:5555", "invalid", "172.30.0.2"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = test.peer
		r.Header.Set("X-Forwarded-For", test.forwarded)
		if got := ClientIP(r, proxies); got != test.want {
			t.Fatalf("got %s want %s", got, test.want)
		}
	}
}

package httpx

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func trusted(proxies []netip.Prefix, ip netip.Addr) bool {
	for _, p := range proxies {
		if p.Contains(ip.Unmap()) {
			return true
		}
	}
	return false
}

func ClientIP(r *http.Request, proxies []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	if !trusted(proxies, peer) {
		return peer.Unmap().String()
	}
	// Walk from the closest proxy back to the first untrusted hop. Never trust
	// client-supplied CF-Connecting-IP or X-Forwarded-For without this chain.
	forwarded := r.Header.Get("X-Forwarded-For")
	for {
		remaining, part, found := strings.CutLast(forwarded, ",")
		if !found {
			part = forwarded
		}
		candidate, err := netip.ParseAddr(strings.TrimSpace(part))
		if err != nil {
			return peer.Unmap().String()
		}
		peer = candidate
		if !trusted(proxies, peer) || !found {
			break
		}
		forwarded = remaining
	}
	return peer.Unmap().String()
}

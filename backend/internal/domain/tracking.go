package domain

import (
	"net/url"
	"strings"
)

func ValidPostalTracking(s string) bool {
	if len(s) < 10 || len(s) > 30 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func PostalTrackingURL(code, template string) string {
	if template == "" {
		return "https://pishkhan24.com/posttracking/?barcode=" + url.QueryEscape(code)
	}
	if !strings.HasPrefix(template, "https://pishkhan24.com/") {
		return "https://pishkhan24.com/posttracking/?barcode=" + url.QueryEscape(code)
	}
	return strings.ReplaceAll(template, "{tracking}", url.QueryEscape(code))
}

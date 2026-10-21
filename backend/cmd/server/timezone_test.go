package main

import (
	"testing"
	"time"
)

// Also run this test binary without system/GOROOT zoneinfo to check the
// embedded fallback used by the minimal production image.
func TestTehranTimeZone(t *testing.T) {
	zone, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		t.Fatalf("load reporting timezone: %v", err)
	}
	for _, tc := range []struct {
		name string
		utc  string
		want string
	}{
		{"current midnight", "2026-10-20T20:30:00Z", "2026-10-21T00:00:00+03:30"},
		{"historical daylight saving", "2021-07-01T00:00:00Z", "2021-07-01T04:30:00+04:30"},
		{"summer after daylight saving ended", "2026-07-01T00:00:00Z", "2026-07-01T03:30:00+03:30"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			instant, err := time.Parse(time.RFC3339, tc.utc)
			if err != nil {
				t.Fatal(err)
			}
			if got := instant.In(zone).Format(time.RFC3339); got != tc.want {
				t.Fatalf("Tehran time = %s, want %s", got, tc.want)
			}
		})
	}
}

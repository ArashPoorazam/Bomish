package httpx

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestMetricsWindowAndRotation(t *testing.T) {
	var metrics RequestMetrics
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	metrics.Record(now, 200, 10*time.Millisecond)
	metrics.Record(now, 503, 30*time.Millisecond)
	metrics.Record(now, 404, 20*time.Millisecond)
	buckets := metrics.Snapshot(now, now)
	if len(buckets) != 1 || buckets[0].Requests != 3 || buckets[0].Errors != 1 || buckets[0].AverageMS != 20 {
		t.Fatalf("unexpected aggregates: %+v", buckets)
	}
	later := now.Add(30 * time.Minute)
	metrics.Record(later, 200, time.Millisecond)
	buckets = metrics.Snapshot(later, now)
	if len(buckets) != 30 || buckets[29].Requests != 1 {
		t.Fatalf("rotation: %+v", buckets)
	}
	for _, b := range buckets[:29] {
		if b.Requests != 0 {
			t.Fatal("expired request survived rotation")
		}
	}
	for _, b := range metrics.Snapshot(later.Add(time.Hour), now) {
		if b.Requests != 0 {
			t.Fatal("stale bucket reused")
		}
	}
}

func TestMetricsConcurrent(t *testing.T) {
	var metrics RequestMetrics
	now := time.Now()
	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() { metrics.Record(now, 500, time.Millisecond); metrics.Snapshot(now, now) })
	}
	wg.Wait()
	if b := metrics.Snapshot(now, now)[0]; b.Requests != 100 || b.Errors != 100 {
		t.Fatalf("lost requests: %+v", b)
	}
}

func TestObserveMetricsExcludeProbes(t *testing.T) {
	var metrics RequestMetrics
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) })
	handler := Observe(mux, mux, &metrics)
	started := time.Now()
	for _, path := range []string{"/api/v1/health", "/api/v1/omnisire/monitoring", "/uploads/a.png", "/api/v1/products"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
	}
	var count int64
	for _, b := range metrics.Snapshot(time.Now(), started) {
		count += b.Requests
	}
	if count != 1 {
		t.Fatalf("counted probes or static files: %d", count)
	}
}

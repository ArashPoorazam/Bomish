package httpx

import (
	"sync"
	"time"
)

// RequestMetrics keeps bounded, process-local aggregates; it stores no request data.
type RequestMetrics struct {
	mu      sync.Mutex
	buckets [30]RequestBucket
}

type RequestBucket struct {
	At         time.Time `json:"at"`
	Requests   int64     `json:"requests"`
	Errors     int64     `json:"errors"`
	DurationMS float64   `json:"-"`
	AverageMS  float64   `json:"averageMs"`
}

func (m *RequestMetrics) Record(at time.Time, status int, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	minute := at.UTC().Truncate(time.Minute)
	b := &m.buckets[(minute.Unix()/60)%int64(len(m.buckets))]
	if !b.At.Equal(minute) {
		*b = RequestBucket{At: minute}
	}
	b.Requests++
	if status >= 500 {
		b.Errors++
	}
	b.DurationMS += float64(duration) / float64(time.Millisecond)
}

// Snapshot includes the current partial minute and the preceding 29 minutes.
func (m *RequestMetrics) Snapshot(now, started time.Time) []RequestBucket {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]RequestBucket, 0, len(m.buckets))
	for i := len(m.buckets) - 1; i >= 0; i-- {
		at := now.UTC().Truncate(time.Minute).Add(-time.Duration(i) * time.Minute)
		if at.Before(started.UTC().Truncate(time.Minute)) {
			continue
		}
		b := m.buckets[(at.Unix()/60)%int64(len(m.buckets))]
		if !b.At.Equal(at) {
			b = RequestBucket{At: at}
		}
		if b.Requests > 0 {
			b.AverageMS = b.DurationMS / float64(b.Requests)
		}
		out = append(out, b)
	}
	return out
}

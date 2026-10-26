package app

import (
	"context"
	"testing"
	"time"
)

func TestSystemResourceParsing(t *testing.T) {
	cpu := parseCPU("cpu 100 20 30 400 50 6 7 8 90 10\ncpu0 0 0 0 0")
	if cpu == nil || cpu.total != 621 || cpu.idle != 450 {
		t.Fatalf("guest time counted twice or wrong idle: %+v", cpu)
	}
	for _, raw := range []string{"", "cpu 1 2", "cpu x 1 2 3"} {
		if parseCPU(raw) != nil {
			t.Fatalf("accepted invalid CPU: %q", raw)
		}
	}
	mem := parseMemory("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB")
	if mem == nil || mem.TotalBytes != 1024000 || mem.AvailableBytes != 409600 {
		t.Fatalf("wrong memory: %+v", mem)
	}
	for _, raw := range []string{"", "MemTotal: 1000 kB", "MemTotal: 0 kB\nMemAvailable: 0 kB", "MemTotal: 100 kB\nMemAvailable: 200 kB"} {
		if parseMemory(raw) != nil {
			t.Fatalf("accepted invalid memory: %q", raw)
		}
	}
}
func TestCPUCounterDelta(t *testing.T) {
	previous := &cpuCounters{total: 100, idle: 60}
	current := &cpuCounters{total: 200, idle: 85}
	if got := cpuUsage(previous, current); got == nil || *got != 75 {
		t.Fatalf("wrong CPU usage: %v", got)
	}
	for _, pair := range [][2]*cpuCounters{{nil, current}, {previous, nil}, {current, previous}, {previous, previous}, {previous, {total: 200, idle: 59}}, {previous, {total: 200, idle: 200}}} {
		if cpuUsage(pair[0], pair[1]) != nil {
			t.Fatal("invalid delta must be unavailable")
		}
	}
}
func TestResourceHistoryRetentionAndSampling(t *testing.T) {
	a := &App{}
	now := time.Now().UTC()
	for i := 0; i < 130; i++ {
		a.resourceMetrics.samples = append(a.resourceMetrics.samples, resourceSample{At: now.Add(-time.Duration(130-i) * resourceInterval)})
	}
	if err := a.SampleResources(context.Background()); err != nil {
		t.Fatal(err)
	}
	history := a.resourceHistory()
	if len(history) != resourceLimit {
		t.Fatalf("unbounded history: %d", len(history))
	}
	if history[0].At.Before(now.Add(-30 * time.Minute)) {
		t.Fatal("expired sample retained")
	}
	if history[len(history)-1].Memory == nil {
		t.Fatal("expected Linux memory measurements")
	}
	if err := a.SampleResources(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(a.resourceHistory()) != resourceLimit {
		t.Fatal("duplicate sample collected")
	}
	history[0].At = time.Time{}
	if a.resourceHistory()[0].At.IsZero() {
		t.Fatal("snapshot aliases internal history")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if a.SampleResources(ctx) == nil {
		t.Fatal("ignored shutdown")
	}
}

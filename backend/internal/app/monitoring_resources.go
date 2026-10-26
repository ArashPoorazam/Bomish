package app

import (
	"context"
	"sync"
	"time"

	"bomish/internal/storage"
)

const resourceInterval = 15 * time.Second
const resourceLimit = 120

type systemMemory struct {
	TotalBytes     uint64 `json:"totalBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}
type resourceSample struct {
	At                 time.Time     `json:"at"`
	CPUPercent         *float64      `json:"cpuPercent"`
	Memory             *systemMemory `json:"memory"`
	Disk               *diskStatus   `json:"disk"`
	ConnectionsPercent *float64      `json:"connectionsPercent"`
}
type cpuCounters struct{ total, idle uint64 }
type resourceMetrics struct {
	mu       sync.Mutex
	previous *cpuCounters
	samples  []resourceSample
}

func cpuUsage(previous, current *cpuCounters) *float64 {
	if previous == nil || current == nil || current.total <= previous.total || current.idle < previous.idle {
		return nil
	}
	total, idle := current.total-previous.total, current.idle-previous.idle
	if idle > total {
		return nil
	}
	percent := 100 * float64(total-idle) / float64(total)
	return &percent
}

// Samples independently of the dashboard; retained in memory for this API instance.
func (a *App) SampleResources(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	a.resourceMetrics.mu.Lock()
	defer a.resourceMetrics.mu.Unlock()
	now := time.Now().UTC()
	history := a.resourceMetrics.samples
	if len(history) > 0 && now.Truncate(resourceInterval).Equal(history[len(history)-1].At.Truncate(resourceInterval)) {
		return nil
	}
	cpu, memory := monitorSystem()
	sample := resourceSample{At: now, CPUPercent: cpuUsage(a.resourceMetrics.previous, cpu), Memory: memory}
	a.resourceMetrics.previous = cpu
	if local, ok := a.Uploads.(storage.Local); ok {
		sample.Disk = monitorDisk(local.Root)
	}
	if a.Pool != nil {
		stat := a.Pool.Stat()
		if stat.MaxConns() > 0 {
			percent := 100 * float64(stat.AcquiredConns()) / float64(stat.MaxConns())
			sample.ConnectionsPercent = &percent
		}
	}
	cutoff := now.Add(-30 * time.Minute)
	start := 0
	for start < len(history) && (history[start].At.Before(cutoff) || len(history)-start >= resourceLimit) {
		start++
	}
	a.resourceMetrics.samples = append(history[start:], sample)
	return nil
}

func (a *App) resourceHistory() []resourceSample {
	a.resourceMetrics.mu.Lock()
	defer a.resourceMetrics.mu.Unlock()
	return append([]resourceSample{}, a.resourceMetrics.samples...)
}

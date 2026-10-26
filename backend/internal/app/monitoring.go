package app

import (
	"context"
	"net/http"
	"runtime"
	"time"

	"bomish/internal/httpx"
	"bomish/internal/storage"
)

type diskStatus struct {
	TotalBytes     uint64 `json:"totalBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}

func (a *App) monitoring(w http.ResponseWriter, r *http.Request) {
	_ = a.SampleResources(r.Context())
	history := a.resourceHistory()
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	pingStarted := time.Now()
	err := a.Pool.Ping(ctx)
	latency := float64(time.Since(pingStarted)) / float64(time.Millisecond)
	databaseStatus := "healthy"
	if err != nil {
		databaseStatus = "unavailable"
	}
	stat := a.Pool.Stat()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	var disk *diskStatus
	if local, ok := a.Uploads.(storage.Local); ok {
		disk = monitorDisk(local.Root)
	}
	now := time.Now().UTC()
	status := "healthy"
	if err != nil || (disk != nil && float64(disk.AvailableBytes)/float64(disk.TotalBytes) < 0.15) {
		status = "attention"
	}
	traffic := a.requestMetrics.Snapshot(now, a.startedAt)
	var requests, errors int64
	for _, bucket := range traffic {
		requests += bucket.Requests
		errors += bucket.Errors
	}
	if requests > 0 && float64(errors)/float64(requests) > 0.05 {
		status = "attention"
	}
	environment := "production"
	if a.Dev {
		environment = "development"
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"status": status, "checkedAt": now, "startedAt": a.startedAt,
		"uptimeSeconds": int64(now.Sub(a.startedAt).Seconds()), "environment": environment,
		"catalogOnly": a.CatalogOnly,
		"database":    map[string]any{"status": databaseStatus, "latencyMs": latency, "activeConnections": stat.AcquiredConns(), "idleConnections": stat.IdleConns(), "maxConnections": stat.MaxConns()},
		"runtime":     map[string]any{"version": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "cpuCount": runtime.NumCPU(), "goroutines": runtime.NumGoroutine(), "heapBytes": memory.HeapAlloc, "reservedBytes": memory.Sys},
		"disk":        disk, "traffic": traffic, "resources": history,
	})
}

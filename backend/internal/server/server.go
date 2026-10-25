// Package server owns the HTTP and background-job lifecycle. It has no business
// dependencies: jobs are supplied by the composition root in cmd/server.
package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

const shutdownTimeout = 5 * time.Second

type Job struct {
	Name     string
	Interval time.Duration
	Run      func(context.Context) error
}

// Serve owns listener. It returns only after HTTP shutdown and all jobs finish,
// so the caller can safely close shared resources such as the database pool.
func Serve(ctx context.Context, srv *http.Server, listener net.Listener, jobs ...Job) error {
	for _, job := range jobs {
		if job.Interval <= 0 || job.Run == nil {
			listener.Close()
			return errors.New("background jobs require a positive interval and a run function")
		}
	}
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var workers sync.WaitGroup
	for _, job := range jobs {
		workers.Go(func() { runJob(workerCtx, job) })
	}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(listener) }()
	var serveErr error
	finished := false
	select {
	case <-ctx.Done():
	case serveErr = <-served:
		finished = true
	}
	cancel()
	shutdownCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer stop()
	shutdownErr := srv.Shutdown(shutdownCtx)
	if shutdownErr != nil {
		_ = srv.Close()
	}
	if !finished {
		serveErr = <-served
	}
	workers.Wait()
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	return errors.Join(serveErr, shutdownErr)
}

// Each job is serial within an instance. Durable database leases coordinate
// instances. Separate jobs prevent slow carriers from delaying order expiry.
func runJob(ctx context.Context, job Job) {
	ticker := time.NewTicker(job.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if ctx.Err() != nil {
				return
			}
			if err := job.Run(ctx); err != nil && ctx.Err() == nil {
				// Transport/database errors may contain credentials or customer data.
				slog.Error("background job failed", "job", job.Name)
			}
		}
	}
}

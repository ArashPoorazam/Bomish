package server

import (
	"context"
	"io"
	"net"
	"net/http"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

func TestJobDoesNotOverlapOrRunAfterCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		calls, active := 0, false
		done := make(chan struct{})
		go func() {
			defer close(done)
			runJob(ctx, Job{Name: "test", Interval: time.Second, Run: func(ctx context.Context) error {
				if active {
					t.Error("overlapping invocation")
				}
				active = true
				calls++
				<-ctx.Done()
				active = false
				return ctx.Err()
			}})
		}()
		synctest.Wait()
		time.Sleep(5 * time.Second)
		synctest.Wait()
		if calls != 1 {
			t.Fatalf("calls=%d", calls)
		}
		cancel()
		<-done
		time.Sleep(5 * time.Second)
		if calls != 1 || active {
			t.Fatal("job survived cancellation")
		}
	})
}

func TestServeWaitsForRequestsAndWorkers(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	requestStarted, workerStarted := make(chan struct{}), make(chan struct{})
	releaseRequest, releaseWorker := make(chan struct{}), make(chan struct{})
	var requestOnce, workerOnce sync.Once
	unblockRequest := func() { requestOnce.Do(func() { close(releaseRequest) }) }
	unblockWorker := func() { workerOnce.Do(func() { close(releaseWorker) }) }
	t.Cleanup(unblockRequest)
	t.Cleanup(unblockWorker)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})}
	stopped := make(chan error, 1)
	go func() {
		stopped <- Serve(ctx, srv, listener, Job{Name: "test", Interval: time.Millisecond, Run: func(ctx context.Context) error {
			close(workerStarted)
			<-ctx.Done()
			<-releaseWorker // Model a bounded cleanup after cancellation.
			return nil
		}})
	}()
	response := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		res, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			_, err = io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}
		response <- err
	}()
	await(t, requestStarted)
	await(t, workerStarted)
	cancel()
	select {
	case err := <-stopped:
		t.Fatalf("returned before request drained: %v", err)
	default:
	}
	unblockRequest()
	if err := <-response; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-stopped:
		t.Fatalf("returned before worker cleanup: %v", err)
	default:
	}
	unblockWorker()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not complete")
	}
}

func await(t *testing.T, ready <-chan struct{}) {
	t.Helper()
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		t.Fatal("operation did not start")
	}
}

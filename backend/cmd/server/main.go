package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	// Minimal runtime images do not include a system timezone database.
	_ "time/tzdata"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := runMain(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func runMain() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return run(ctx, os.Args[1:])
}

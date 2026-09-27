package main

import (
	"bomish/internal/app"
	"bomish/internal/db"
	"bomish/internal/storage"
	"bomish/migrations"
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dev := os.Getenv("APP_ENV") == "development"
	if !dev {
		slog.Error("production disabled: connect and verify real SMS/payment providers before enabling live sales")
		os.Exit(1)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	pool, e := pgxpool.New(ctx, url)
	if e != nil {
		panic(e)
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		panic(e)
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		panic(e)
	}
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234109)"); e != nil {
		panic(e)
	}
	if _, e = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)"); e != nil {
		panic(e)
	}
	entries, _ := migrations.Files.ReadDir(".")
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version := strings.SplitN(entry.Name(), "_", 2)[0]
		var exists bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&exists); e != nil {
			panic(e)
		}
		if !exists {
			sql, _ := migrations.Files.ReadFile(entry.Name())
			if _, e = tx.Exec(ctx, string(sql)); e != nil {
				panic(e)
			}
			if _, e = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES($1)", version); e != nil {
				panic(e)
			}
		}
	}
	if e = tx.Commit(ctx); e != nil {
		panic(e)
	}
	origin := os.Getenv("APP_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	root := os.Getenv("UPLOAD_DIR")
	if root == "" {
		root = "../.data/uploads"
		os.Setenv("UPLOAD_DIR", root)
	}
	a := &app.App{Pool: pool, Queries: db.New(pool), Dev: dev, Origin: origin, Uploads: storage.Local{Root: root}}
	if os.Getenv("SEED_DEMO") == "true" {
		if e = a.Seed(ctx); e != nil {
			panic(e)
		}
	}
	if len(os.Args) > 1 && os.Args[1] == "refresh-demo-catalog" {
		if e = a.RefreshDemoCatalog(ctx); e != nil {
			panic(e)
		}
		fmt.Println("Demo catalog refreshed: six package-based products; old fixtures archived.")
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "totp" {
		if !dev {
			os.Exit(1)
		}
		fmt.Println(app.TOTP(app.DemoTOTP, time.Now().Unix()/30))
		return
	}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := a.ProcessSMS(ctx); e != nil {
					slog.Error("SMS processing failed")
				}
				if e := a.ExpireReservations(ctx); e != nil {
					slog.Error("reservation expiry failed", "error", e)
				}
			}
		}
	}()
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	srv := &http.Server{Addr: addr, Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	slog.Info("Bomish development API ready", "address", addr)
	if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		panic(e)
	}
}

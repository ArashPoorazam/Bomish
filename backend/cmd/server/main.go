package main

import (
	"bomish/internal/app"
	"bomish/internal/db"
	"bomish/internal/runtimeconfig"
	"bomish/internal/storage"
	"bomish/migrations"
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	// The minimal runtime image has no system timezone database.
	_ "time/tzdata"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := runtimeconfig.LoadSecrets(); err != nil {
		slog.Error("configuration invalid", "error", err)
		os.Exit(1)
	}
	cfg, err := runtimeconfig.Read()
	if err != nil {
		slog.Error("configuration invalid", "error", err)
		os.Exit(1)
	}
	dev := cfg.Dev
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	switch command {
	case "serve", "migrate", "bootstrap-owner", "recover-owner", "refresh-demo-catalog", "export-shipping-config", "apply-shipping-config", "totp":
	default:
		slog.Error("unknown command")
		os.Exit(1)
	}
	if !dev && (command == "refresh-demo-catalog" || command == "totp") {
		slog.Error("development command forbidden")
		os.Exit(1)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		slog.Error("DATABASE_URL required")
		os.Exit(1)
	}
	pool, e := pgxpool.New(ctx, url)
	if e != nil {
		slog.Error("invalid database connection configuration")
		os.Exit(1)
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		slog.Error("database connection failed")
		os.Exit(1)
	}
	if dev || command == "migrate" {
		if e = migrations.Apply(ctx, pool); e != nil {
			slog.Error("migration failed", "error", e)
			os.Exit(1)
		}
	} else if e = migrations.Check(ctx, pool); e != nil {
		slog.Error("schema not ready", "error", e)
		os.Exit(1)
	}
	if command == "migrate" {
		slog.Info("migrations complete")
		return
	}
	origin := cfg.Origin
	root := os.Getenv("UPLOAD_DIR")
	if root == "" {
		root = "../.data/uploads"
		os.Setenv("UPLOAD_DIR", root)
	}
	a := &app.App{Pool: pool, Queries: db.New(pool), Dev: dev, CatalogOnly: cfg.CatalogOnly, TrustedProxies: cfg.TrustedProxies, TOTPKey: cfg.TOTPKey, Origin: origin, Uploads: storage.Local{Root: root}}
	if command == "bootstrap-owner" || command == "recover-owner" {
		if e = setupOwner(ctx, a, command == "recover-owner"); e != nil {
			slog.Error("owner setup failed", "error", e)
			os.Exit(1)
		}
		return
	}
	if !dev {
		var unsafe int
		if e = pool.QueryRow(ctx, "SELECT count(*) FROM staff WHERE (role='owner' AND totp_secret NOT LIKE 'v1:%') OR totp_secret=$1", app.DemoTOTP).Scan(&unsafe); e != nil || unsafe > 0 {
			slog.Error("production requires a clean database and encrypted owner credentials")
			os.Exit(1)
		}
	}
	if len(os.Args) > 1 && os.Args[1] == "refresh-demo-catalog" {
		if e = a.RefreshDemoCatalog(ctx); e != nil {
			panic(e)
		}
		fmt.Println("Development data refreshed: 30 products and five new staff accounts; historical records archived.")
		return
	}
	if os.Getenv("SEED_DEMO") == "true" {
		if e = a.Seed(ctx); e != nil {
			panic(e)
		}
	}
	if len(os.Args) > 1 && os.Args[1] == "export-shipping-config" {
		if e = a.ExportShippingConfig(ctx, os.Stdout); e != nil {
			panic(e)
		}
		return
	}
	configPath := os.Getenv("SHIPPING_CONFIG_FILE")
	if configPath != "" {
		if e = a.ApplyShippingConfig(ctx, configPath); e != nil {
			panic(e)
		}
	}
	if len(os.Args) > 1 && os.Args[1] == "apply-shipping-config" {
		if configPath == "" {
			panic("SHIPPING_CONFIG_FILE required")
		}
		fmt.Println("Shipping configuration applied.")
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "totp" {
		if !dev {
			os.Exit(1)
		}
		fmt.Println(app.TOTP(app.DemoTOTP, time.Now().Unix()/30))
		return
	}
	if e = app.ValidateSMSConfig(origin); e != nil {
		slog.Error("SMS configuration invalid", "error", e)
		os.Exit(1)
	}
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := a.ProcessExports(ctx); e != nil {
					slog.Error("report export failed", "error", e)
				}
			}
		}
	}()
	go func() {
		if a.CatalogOnly {
			return
		}
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := a.ProcessShipments(ctx); e != nil {
					slog.Error("shipping worker failed")
				}
				if e := a.ExpireReservations(ctx); e != nil {
					slog.Error("reservation expiry failed", "error", e)
				}
			}
		}
	}()
	// Carrier requests can be slow; SMS has its own independent worker.
	go func() {
		if a.CatalogOnly {
			return
		}
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := a.ProcessSMS(ctx); e != nil {
					slog.Error("SMS processing failed")
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
	slog.Info("Bomish API ready", "address", addr)
	if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		panic(e)
	}
}

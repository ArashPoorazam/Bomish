package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"

	"bomish/internal/app"
	"bomish/internal/db"
	"bomish/internal/runtimeconfig"
	"bomish/internal/security"
	"bomish/internal/server"
	"bomish/internal/storage"
	"bomish/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
)

func run(ctx context.Context, args []string) error {
	command := "serve"
	if len(args) > 0 {
		command = args[0]
	}
	switch command {
	case "serve", "migrate", "bootstrap-owner", "recover-owner", "refresh-demo-catalog", "prepare-local-copy", "export-shipping-config", "apply-shipping-config", "totp":
	default:
		return errors.New("unknown command")
	}
	if err := runtimeconfig.LoadSecrets(); err != nil {
		return err
	}
	cfg, err := runtimeconfig.Read()
	if err != nil {
		return err
	}
	if !cfg.Dev && (command == "refresh-demo-catalog" || command == "totp") {
		return errors.New("development command forbidden")
	}
	if command == "prepare-local-copy" {
		// Check before connecting or migrating. Only the launcher's disposable,
		// loopback staging databases may have their authentication data replaced.
		u, parseErr := url.Parse(cfg.DatabaseURL)
		if parseErr != nil || !cfg.Dev || u.Scheme != "postgres" || u.Hostname() != "127.0.0.1" || u.Port() != "55432" || u.RawQuery != "sslmode=disable" || !regexp.MustCompile(`^/bomish_dev_[a-f0-9]{32}$`).MatchString(u.Path) {
			return errors.New("prepare-local-copy requires a launcher-created local staging database")
		}
	}
	if command == "totp" {
		fmt.Println(security.TOTP(app.DemoTOTP, time.Now().Unix()/30))
		return nil
	}
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL required")
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("invalid database connection configuration")
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return errors.New("database connection failed")
	}
	if cfg.Dev || command == "migrate" {
		if err := migrations.Apply(ctx, pool); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	} else if err := migrations.Check(ctx, pool); err != nil {
		return fmt.Errorf("schema not ready: %w", err)
	}
	if command == "migrate" {
		slog.Info("migrations complete")
		return nil
	}
	uploads := storage.Local{Root: cfg.UploadDir}
	a := &app.App{Pool: pool, Queries: db.New(pool), Dev: cfg.Dev, CatalogOnly: cfg.CatalogOnly, TrustedProxies: cfg.TrustedProxies, TOTPKey: cfg.TOTPKey, Origin: cfg.Origin, Uploads: uploads, UploadHandler: uploads.Handler()}
	if command == "prepare-local-copy" {
		return a.PrepareLocalCopy(ctx)
	}
	if command == "bootstrap-owner" || command == "recover-owner" {
		return setupOwner(ctx, a, command == "recover-owner")
	}
	if !cfg.Dev {
		var unsafe bool
		err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM staff WHERE (role='owner' AND totp_secret NOT LIKE 'v1:%') OR totp_secret=$1)", app.DemoTOTP).Scan(&unsafe)
		if err != nil || unsafe {
			return errors.New("production requires a clean database and encrypted owner credentials")
		}
	}
	if command == "refresh-demo-catalog" {
		if err := a.RefreshDemoCatalog(ctx); err != nil {
			return err
		}
		fmt.Println("Development data refreshed: 30 products and five new staff accounts; historical records archived.")
		return nil
	}
	if cfg.SeedDemo {
		if err := a.Seed(ctx); err != nil {
			return err
		}
	}
	if command == "export-shipping-config" {
		return a.ExportShippingConfig(ctx, os.Stdout)
	}
	if cfg.ShippingConfigFile != "" {
		if err := a.ApplyShippingConfig(ctx, cfg.ShippingConfigFile); err != nil {
			return err
		}
	}
	if command == "apply-shipping-config" {
		if cfg.ShippingConfigFile == "" {
			return errors.New("SHIPPING_CONFIG_FILE required")
		}
		fmt.Println("Shipping configuration applied.")
		return nil
	}
	if err := app.ValidateSMSConfig(cfg.Origin); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	jobs := []server.Job{{Name: "report-exports", Interval: 3 * time.Second, Run: a.ProcessExports}}
	if !cfg.CatalogOnly {
		jobs = append(jobs,
			server.Job{Name: "shipments", Interval: 30 * time.Second, Run: a.ProcessShipments},
			server.Job{Name: "order-expiry", Interval: 30 * time.Second, Run: a.ExpireReservations},
			server.Job{Name: "sms", Interval: 5 * time.Second, Run: a.ProcessSMS},
		)
	}
	srv := &http.Server{Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	slog.Info("Bomish API ready", "address", listener.Addr().String())
	return server.Serve(ctx, srv, listener, jobs...)
}

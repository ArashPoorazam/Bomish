package app

import (
	"context"
	"encoding/json"
	"fmt"

	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

const DemoTOTP = "JBSWY3DPEHPK3PXP"
const DemoPassword = "Bomish-demo-2026!"

func (a *App) Seed(ctx context.Context) error {
	if !a.Dev {
		return nil
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234110)"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM staff)").Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	if err = writeDemoCatalog(ctx, tx); err != nil {
		return err
	}
	if err = writeDemoStaff(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func writeDemoStaff(ctx context.Context, tx pgx.Tx) error {
	for _, s := range []struct{ role, name string }{
		{"owner", "آرمان رضایی"}, {"manager", "سارا احمدی"}, {"editor", "نیلوفر کریمی"}, {"operator", "امیر محمدی"}, {"salesperson", "مریم حسینی"},
	} {
		// Fresh IDs prevent historical commissions or activity being assigned to new people.
		if _, err := tx.Exec(ctx, `INSERT INTO staff(id,username,full_name,password_hash,totp_secret,role) VALUES($1,$2,$3,$4,$5,$2)`, security.Token(), s.role, s.name, security.PasswordHash(DemoPassword), DemoTOTP); err != nil {
			return err
		}
	}
	return nil
}

func writeDemoCatalog(ctx context.Context, tx pgx.Tx) error {
	for _, c := range [][2]string{{"spices", "ادویه‌ها"}, {"herbs", "سبزی‌های خشک"}, {"seeds", "دانه‌های خوراکی"}, {"salts", "نمک‌ها"}, {"oils", "روغن‌ها"}, {"dried-fruit", "خشکبار"}} {
		if _, err := tx.Exec(ctx, "INSERT INTO categories(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name", c[0], c[1]); err != nil {
			return err
		}
	}
	for _, p := range demoProducts() {
		if err := p.Validate(true); err != nil {
			return fmt.Errorf("demo product %s: %w", p.ID, err)
		}
		raw, err := json.Marshal(p)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO products(id,slug,name,category_id,status,price_rials,min_grams,step_grams,max_grams,search_text,content,first_published_at) VALUES($1,$2,$3,$4,'published',0,1,1,1000000,$5,$6,now()) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,category_id=excluded.category_id,status='published',price_rials=0,min_grams=1,step_grams=1,max_grams=1000000,search_text=excluded.search_text,content=excluded.content,updated_at=now()`, p.ID, p.Slug, p.Name, p.CategoryID, searchText(p), raw); err != nil {
			return err
		}
	}
	for i, id := range []string{"pantry-saffron", "pantry-turmeric", "pantry-black-pepper", "pantry-mint", "pantry-sesame", "pantry-olive-oil", "pantry-barberry", "pantry-cinnamon"} {
		if _, err := tx.Exec(ctx, "INSERT INTO product_suggestions(product_id,position) VALUES($1,$2)", id, i); err != nil {
			return err
		}
	}
	return writeDemoArticles(ctx, tx)
}

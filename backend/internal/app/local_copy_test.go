package app

import (
	"context"
	"testing"

	"bomish/internal/security"
)

func TestPrepareLocalCopyRejectsProduction(t *testing.T) {
	if err := (&App{}).PrepareLocalCopy(context.Background()); err == nil {
		t.Fatal("production must be rejected before accessing the database")
	}
}

func TestPrepareLocalCopyPreservesContentAndReplacesAuthentication(t *testing.T) {
	a := setupCatalog(t, false)
	ctx := context.Background()
	var oldOwner string
	if err := a.Pool.QueryRow(ctx, "SELECT id FROM staff WHERE username='owner'").Scan(&oldOwner); err != nil {
		t.Fatal(err)
	}
	_, err := a.Pool.Exec(ctx, `
		INSERT INTO sessions(token_hash,csrf,staff_id,expires_at) VALUES('production-session','csrf',$1,now()+interval '1 hour');
	`, oldOwner)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.Pool.Exec(ctx, `
		INSERT INTO otp_challenges(phone,code_hash,expires_at,sent_at) VALUES('09123456789','secret',now()+interval '1 hour',now());
		INSERT INTO jobs(kind,payload) VALUES('order_sms','{"phone":"09123456789"}');
		UPDATE categories SET name='Production category' WHERE id='spices';
	`)
	if err != nil {
		t.Fatal(err)
	}
	var before string
	if err = a.Pool.QueryRow(ctx, "SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM products p").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = a.PrepareLocalCopy(ctx); err != nil {
		t.Fatal(err)
	}
	var after, category, hash, secret, newOwner string
	var sessions, otp, jobs, active int
	var oldDisabled bool
	if err = a.Pool.QueryRow(ctx, `SELECT
		(SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM products p),
		(SELECT name FROM categories WHERE id='spices'),
		(SELECT count(*) FROM sessions), (SELECT count(*) FROM otp_challenges),
		(SELECT count(*) FROM jobs), (SELECT count(*) FROM staff WHERE active),
		(SELECT NOT active AND password_hash='' AND totp_secret='' AND archived_at IS NOT NULL FROM staff WHERE id=$1)
	`, oldOwner).Scan(&after, &category, &sessions, &otp, &jobs, &active, &oldDisabled); err != nil {
		t.Fatal(err)
	}
	if before != after || category != "Production category" || sessions != 0 || otp != 0 || jobs != 0 || active != 5 || !oldDisabled {
		t.Fatal("production content or local authentication isolation was not preserved")
	}
	if err = a.Pool.QueryRow(ctx, "SELECT id,password_hash,totp_secret FROM staff WHERE username='owner'").Scan(&newOwner, &hash, &secret); err != nil {
		t.Fatal(err)
	}
	if oldOwner == newOwner || !security.CheckPassword(hash, DemoPassword) || secret != DemoTOTP {
		t.Fatal("local owner must have a fresh identity and working development credentials")
	}
}

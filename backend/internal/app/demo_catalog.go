package app

import (
	"context"
	"errors"
)

// RefreshDemoCatalog is an explicit development command, never a startup reset.
// Historical rows remain archived so order, ledger and audit references stay valid.
func (a *App) RefreshDemoCatalog(ctx context.Context) error {
	if !a.Dev {
		return errors.New("demo refresh is development-only")
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234110)"); err != nil {
		return err
	}
	// Lock both catalogs before invalidating sessions or replacing their contents.
	if _, err = tx.Exec(ctx, "LOCK TABLE staff,products IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return err
	}
	for _, sql := range []string{
		"DELETE FROM sessions WHERE staff_id IS NOT NULL",
		"UPDATE sessions SET referral_staff_id=NULL,referral_seen_at=NULL WHERE referral_staff_id IS NOT NULL",
		"UPDATE staff SET active=false,archived_at=coalesce(archived_at,now()),username='archived-'||id WHERE archived_at IS NULL",
		"DELETE FROM report_exports WHERE status IN ('pending','running')",
		"DELETE FROM product_suggestions",
		"DELETE FROM product_drafts",
		"DELETE FROM carts",
		"UPDATE product_discounts SET active=false",
		"UPDATE products SET status='archived',slug='archived-'||id,content=jsonb_set(content,'{status}','\"archived\"'),updated_at=now()",
	} {
		if _, err = tx.Exec(ctx, sql); err != nil {
			return err
		}
	}
	if err = writeDemoCatalog(ctx, tx); err != nil {
		return err
	}
	if err = writeDemoStaff(ctx, tx); err != nil {
		return err
	}
	// Replace known article references and discard links to removed custom products.
	for _, table := range []string{"articles", "article_drafts"} {
		if _, err = tx.Exec(ctx, `UPDATE `+table+` a SET content=jsonb_set(content,'{productIds}',coalesce((SELECT jsonb_agg(DISTINCT to_jsonb(p.id)) FROM jsonb_array_elements_text(coalesce(nullif(a.content->'productIds','null'::jsonb),'[]'::jsonb)) old(id) JOIN products p ON p.status='published' AND (p.id=old.id OR p.id='pantry-'||old.id OR p.id='pantry-'||replace(old.id,'demo-',''))),'[]'::jsonb))`); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

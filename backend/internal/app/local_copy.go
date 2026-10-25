package app

import (
	"context"
	"errors"
)

// PrepareLocalCopy removes usable production authentication and pending work
// from a restored development database. This is not customer-data anonymization.
func (a *App) PrepareLocalCopy(ctx context.Context) error {
	if !a.Dev {
		return errors.New("local copies are development-only")
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, sql := range []string{
		"DELETE FROM sessions",
		"DELETE FROM otp_challenges",
		"DELETE FROM rate_limits",
		"DELETE FROM report_exports",
		"DELETE FROM sms_attempts",
		"DELETE FROM jobs",
		// Preserve staff IDs for historical foreign keys, but remove credentials
		// and free the standard test usernames without reassigning old records.
		"UPDATE staff SET username='local-archived-'||id, active=false, archived_at=coalesce(archived_at,now()), password_hash='', totp_secret='', last_totp_step=0, phone='', bank_card=''",
	} {
		if _, err = tx.Exec(ctx, sql); err != nil {
			return err
		}
	}
	if err = writeDemoStaff(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

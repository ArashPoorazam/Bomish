package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"bomish/internal/domain"

	"github.com/jackc/pgx/v5"
)

type orderSMSPayload struct {
	Courier *domain.CourierContact `json:"courier,omitempty"`
	OrderID string                 `json:"orderId"`
	Stage   string                 `json:"stage"`
	Phone   string                 `json:"phone"`
	Method  string                 `json:"method"`
}

// Order history and notification intent commit together. Disabled sends are
// permanently skipped, so switching SMS on never drains a development backlog.
func queueOrderSMS(ctx context.Context, tx pgx.Tx, id, stage string, contacts ...*domain.CourierContact) error {
	switch stage {
	case "paid", "packing", "shipped", "received":
	default:
		return errors.New("invalid SMS milestone")
	}
	if _, err := tx.Exec(ctx, "INSERT INTO order_events(order_id,status) VALUES($1,$2) ON CONFLICT DO NOTHING", id, stage); err != nil {
		return err
	}
	p := orderSMSPayload{OrderID: id, Stage: stage}
	if len(contacts) > 0 {
		p.Courier = contacts[0]
	}
	err := tx.QueryRow(ctx, `SELECT u.phone,coalesce(s.method,'legacy_postal') FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN order_shipping s ON s.order_id=o.id WHERE o.id=$1`, id).Scan(&p.Phone, &p.Method)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	status, reason := "pending", ""
	if !smsEnabled() {
		status, reason = "skipped", "sms_disabled"
	}
	_, err = tx.Exec(ctx, `INSERT INTO jobs(kind,payload,status,last_error) VALUES('order_sms',$1,$2,$3) ON CONFLICT DO NOTHING`, raw, status, reason)
	return err
}

type smsJob struct {
	ID        int64
	AttemptID int64
	Attempts  int
	Payload   orderSMSPayload
	Template  string
}

// Commit the sending state BEFORE calling the provider. A process crash can then
// leave an uncertain send, but cannot turn it back into an automatic retry.
func (a *App) claimSMS(ctx context.Context) (*smsJob, error) {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job := &smsJob{}
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT id,payload,attempts FROM jobs WHERE kind='order_sms' AND status='pending' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&job.ID, &raw, &job.Attempts)
	if err != nil {
		return nil, err
	}
	reason := ""
	if json.Unmarshal(raw, &job.Payload) != nil || job.Payload.OrderID == "" || job.Payload.Phone == "" {
		reason = "invalid_payload"
	} else {
		var current string
		err = tx.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, job.Payload.OrderID).Scan(&current)
		if err == pgx.ErrNoRows {
			reason = "order_missing"
		} else if err != nil {
			return nil, err
		} else if current != job.Payload.Stage {
			reason = "superseded"
		}
	}
	if reason != "" {
		_, err = tx.Exec(ctx, `UPDATE jobs SET status='skipped',last_error=$2 WHERE id=$1`, job.ID, reason)
		if err != nil {
			return nil, err
		}
		return job, tx.Commit(ctx)
	}
	if job.Payload.Stage == "packing" {
		var ready bool
		err = tx.QueryRow(ctx, `SELECT (SELECT count(*)>0 AND coalesce(bool_and(packed),false) FROM order_items WHERE order_id=$1)
			AND coalesce((SELECT ready FROM order_shipping WHERE order_id=$1),true)`, job.Payload.OrderID).Scan(&ready)
		if err != nil {
			return nil, err
		}
		if !ready {
			// Packing can be reopened after confirmation. Keep the same intent,
			// but wait for completion rather than announce an incomplete parcel.
			_, err = tx.Exec(ctx, `UPDATE jobs SET available_at=now()+interval '30 seconds',last_error='awaiting_packing' WHERE id=$1`, job.ID)
			if err != nil {
				return nil, err
			}
			return job, tx.Commit(ctx)
		}
	}
	if job.Payload.Stage == "shipped" && job.Payload.Method == "snapp" {
		if job.Payload.Courier == nil || !domain.ValidPhone(domain.Phone(job.Payload.Courier.Phone)) {
			job.Payload.Courier, err = orderCourierContact(ctx, tx, job.Payload.OrderID)
			if err != nil {
				return nil, err
			}
		}
		if job.Payload.Courier == nil || !domain.ValidPhone(domain.Phone(job.Payload.Courier.Phone)) {
			// A later provider update can supply the driver's contact. Never invent a phone number.
			_, err = tx.Exec(ctx, `UPDATE jobs SET available_at=now()+interval '30 seconds',last_error='awaiting_courier_details' WHERE id=$1`, job.ID)
			if err != nil {
				return nil, err
			}
			return job, tx.Commit(ctx)
		}
		job.Payload.Courier.Phone = domain.Phone(job.Payload.Courier.Phone)
		raw, err = json.Marshal(job.Payload)
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "UPDATE jobs SET payload=$2 WHERE id=$1", job.ID, raw); err != nil {
			return nil, err
		}
	}
	job.Template = orderSMSTemplate(job.Payload.Stage, job.Payload.Method)
	err = tx.QueryRow(ctx, `INSERT INTO sms_attempts(job_id,purpose,template,receptor,status) VALUES($1,$2,$3,$4,'sending') RETURNING id`, job.ID, job.Payload.Stage, job.Template, job.Payload.Phone).Scan(&job.AttemptID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE jobs SET status='sending',started_at=now(),attempts=attempts+1,last_error='' WHERE id=$1`, job.ID)
	if err != nil {
		return nil, err
	}
	job.Attempts++
	return job, tx.Commit(ctx)
}

func (a *App) finishSMS(ctx context.Context, job *smsJob, result smsResult) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Recovery locks jobs before attempts too; use the same order to avoid a deadlock.
	var statusBefore string
	if err = tx.QueryRow(ctx, `SELECT status FROM jobs WHERE id=$1 FOR UPDATE`, job.ID).Scan(&statusBefore); err != nil {
		return err
	}
	if err = finishSMSAttempt(ctx, tx, job.AttemptID, result); err != nil {
		return err
	}
	status := result.Status
	if status == "rejected" {
		status = "failed"
		if result.Retryable && job.Attempts < 8 {
			status = "pending"
		}
	}
	_, err = tx.Exec(ctx, `UPDATE jobs SET status=$2,last_error=$3,available_at=CASE WHEN $2='pending' THEN now()+($4 * interval '1 minute') ELSE available_at END WHERE id=$1 AND status IN ('sending','unknown')`, job.ID, status, result.ErrorCode, 1<<min(job.Attempts-1, 7))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *App) recoverSMS(ctx context.Context) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE jobs SET status='unknown',last_error='worker_interrupted' WHERE kind='order_sms' AND status='sending' AND started_at<now()-interval '2 minutes'`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE sms_attempts SET status='unknown',error_code='worker_interrupted',finished_at=now() WHERE status='sending' AND created_at<now()-interval '2 minutes'`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *App) ProcessSMS(ctx context.Context) error {
	if err := a.recoverSMS(ctx); err != nil {
		return err
	}
	if !smsEnabled() {
		return nil
	}
	for range 10 {
		job, err := a.claimSMS(ctx)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		if job.AttemptID == 0 {
			continue
		}
		result := sendOrderSMS(ctx, job.Payload, job.Template)
		finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		err = a.finishSMS(finishCtx, job, result)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

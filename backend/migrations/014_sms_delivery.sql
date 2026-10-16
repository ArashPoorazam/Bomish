-- SMS delivery tracking: job timestamps, failures, and provider attempts.
ALTER TABLE jobs
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE jobs
    ADD COLUMN last_error text NOT NULL DEFAULT '';

ALTER TABLE jobs
    ADD COLUMN started_at timestamptz;

-- Preserve the best available historical timestamp instead of moving all old
-- notifications into the migration day's analytics bucket.
UPDATE
    jobs j
SET
    created_at = coalesce((
        SELECT
            e.created_at
        FROM order_events e
        WHERE
            e.order_id = j.payload ->> 'orderId'
            AND e.status = j.payload ->> 'stage'), j.available_at)
WHERE
    j.kind = 'order_sms';

-- Old pending notifications may belong to development orders. Never replay them
-- when live templates are first enabled. History and accepted sends are retained.
UPDATE
    jobs
SET
    status = 'skipped',
    last_error = 'pre_activation'
WHERE
    kind = 'order_sms'
    AND status = 'pending';

UPDATE
    jobs
SET
    status = 'accepted'
WHERE
    kind = 'order_sms'
    AND status = 'sent';

-- Keep each provider attempt, including uncertain outcomes, for reconciliation.
CREATE TABLE sms_attempts (
    id bigserial PRIMARY KEY,
    job_id bigint REFERENCES jobs (id),
    purpose text NOT NULL,
    template text NOT NULL,
    receptor text NOT NULL,
    status text NOT NULL CHECK (status IN ('sending', 'accepted', 'rejected', 'unknown')),
    provider_message_id bigint,
    provider_status integer,
    error_code text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

-- Support per-job history and recovery of attempts still marked as sending.
CREATE INDEX sms_attempts_job_idx ON sms_attempts (job_id, id);

CREATE INDEX sms_attempts_sending_idx ON sms_attempts (created_at)
WHERE
    status = 'sending';

CREATE INDEX jobs_sms_sending_idx ON jobs (started_at)
WHERE
    kind = 'order_sms' AND status = 'sending';


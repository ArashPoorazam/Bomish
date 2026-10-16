-- Existing codes remain unlimited per customer unless configured at creation.
ALTER TABLE discount_codes
    ADD COLUMN max_uses_per_customer bigint NOT NULL DEFAULT 0
    CHECK (max_uses_per_customer BETWEEN 0 AND 1000000000);

CREATE INDEX orders_discount_customer_usage_idx
    ON orders (discount_code, user_id)
    WHERE discount_code IS NOT NULL AND status NOT IN ('cancelled', 'expired');

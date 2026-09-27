CREATE TABLE discount_codes (
 code text PRIMARY KEY CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 kind text NOT NULL CHECK(kind IN ('percent','fixed')),
 value bigint NOT NULL CHECK(value > 0 AND value <= 100000000000),
 min_subtotal_rials bigint NOT NULL DEFAULT 0 CHECK(min_subtotal_rials >= 0 AND min_subtotal_rials <= 100000000000),
 max_discount_rials bigint NOT NULL DEFAULT 0 CHECK(max_discount_rials >= 0 AND max_discount_rials <= 100000000000),
 max_uses bigint NOT NULL DEFAULT 0 CHECK(max_uses >= 0),
 expires_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='percent' AND value <= 90) OR (kind='fixed' AND value % 10=0)),
 CHECK(min_subtotal_rials % 10=0 AND max_discount_rials % 10=0)
);
ALTER TABLE orders ADD COLUMN discount_code text REFERENCES discount_codes(code);
ALTER TABLE orders ADD COLUMN discount_rials bigint NOT NULL DEFAULT 0 CHECK(discount_rials >= 0 AND discount_rials <= subtotal_rials);
CREATE INDEX orders_discount_code_idx ON orders(discount_code) WHERE discount_code IS NOT NULL;

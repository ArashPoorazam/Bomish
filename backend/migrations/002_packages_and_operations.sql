ALTER TABLE carts DROP CONSTRAINT carts_pkey;
ALTER TABLE carts ADD COLUMN package_id text NOT NULL DEFAULT 'legacy';
ALTER TABLE carts ADD COLUMN quantity bigint NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 1000);
ALTER TABLE carts ADD PRIMARY KEY(session_hash,product_id,package_id);
-- Preserve open carts. Exactly representable quantities become package counts;
-- incompatible old lines stay visible but require the customer to choose a new package.
UPDATE carts c SET quantity=CASE WHEN c.grams%p.min_grams=0 AND c.grams/p.min_grams BETWEEN 1 AND 5 THEN c.grams/p.min_grams ELSE 1 END,
 package_id=CASE WHEN c.grams%p.min_grams=0 AND c.grams/p.min_grams BETWEEN 1 AND 5 THEN 'legacy' ELSE 'retired' END
 FROM products p WHERE p.id=c.product_id;
ALTER TABLE order_items DROP CONSTRAINT order_items_pkey;
ALTER TABLE order_items ADD COLUMN package_id text NOT NULL DEFAULT 'legacy';
ALTER TABLE order_items ADD COLUMN package_label text NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN quantity bigint NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD PRIMARY KEY(order_id,product_id,package_id);
ALTER TABLE addresses ADD COLUMN latitude double precision;
ALTER TABLE addresses ADD COLUMN longitude double precision;
ALTER TABLE settings ADD COLUMN free_shipping_rials bigint NOT NULL DEFAULT 0 CHECK(free_shipping_rials>=0);
ALTER TABLE settings ADD COLUMN support_url text NOT NULL DEFAULT '';
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CHECK(status IN ('pending','paid','packing','shipped','received','cancelled','expired','review'));
CREATE TABLE order_events(order_id text REFERENCES orders(id),status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(order_id,status));
INSERT INTO order_events(order_id,status,created_at) SELECT id,status,created_at FROM orders WHERE status IN ('paid','packing','shipped');
CREATE TABLE analytics_events(id bigserial PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('view','search')),product_id text REFERENCES products(id),query text NOT NULL DEFAULT '',session_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX analytics_events_date ON analytics_events(created_at);
CREATE INDEX analytics_events_product ON analytics_events(product_id);
CREATE UNIQUE INDEX jobs_order_sms_unique ON jobs ((payload->>'orderId'),(payload->>'stage')) WHERE kind='order_sms';
UPDATE products SET content=jsonb_set(content,'{description}',to_jsonb(replace(content->>'description','با انتخاب وزن دلخواه، به اندازه نیاز آشپزخانه یا کسب‌وکارتان سفارش دهید.','بسته و تعداد مورد نیازتان را انتخاب کنید.'))) WHERE content->>'description' LIKE '%با انتخاب وزن دلخواه%';

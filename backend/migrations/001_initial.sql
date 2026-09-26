CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE categories (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '');
CREATE TABLE products (
 id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
 category_id text NOT NULL REFERENCES categories(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 price_rials bigint NOT NULL DEFAULT 0 CHECK(price_rials BETWEEN 0 AND 100000000000),
 min_grams bigint NOT NULL DEFAULT 100 CHECK(min_grams > 0), step_grams bigint NOT NULL DEFAULT 100 CHECK(step_grams > 0), max_grams bigint NOT NULL DEFAULT 25000 CHECK(max_grams >= min_grams),
 search_text text NOT NULL DEFAULT '', content jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_search_idx ON products USING gin(search_text gin_trgm_ops) WHERE status='published';
CREATE TABLE inventory (product_id text PRIMARY KEY REFERENCES products(id), stock_grams bigint NOT NULL DEFAULT 0 CHECK(stock_grams >= 0), reserved_grams bigint NOT NULL DEFAULT 0 CHECK(reserved_grams >= 0 AND reserved_grams <= stock_grams));
CREATE TABLE users (id text PRIMARY KEY, phone text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE staff (id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, totp_secret text NOT NULL, last_totp_step bigint NOT NULL DEFAULT 0, role text NOT NULL CHECK(role IN ('owner','editor','operator')), active boolean NOT NULL DEFAULT true);
CREATE TABLE sessions (token_hash text PRIMARY KEY, csrf text NOT NULL, user_id text REFERENCES users(id), staff_id text REFERENCES staff(id), expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE otp_challenges (phone text PRIMARY KEY, code_hash text NOT NULL, expires_at timestamptz NOT NULL, sent_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0);
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE carts (session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id), grams bigint NOT NULL CHECK(grams > 0), PRIMARY KEY(session_hash,product_id));
CREATE TABLE addresses (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), recipient text NOT NULL, phone text NOT NULL, province text NOT NULL, city text NOT NULL, street text NOT NULL, postal_code text NOT NULL);
CREATE INDEX addresses_user_idx ON addresses(user_id);
CREATE TABLE shipping_rules (id text PRIMARY KEY, province text NOT NULL, max_grams bigint NOT NULL CHECK(max_grams>0), fee_rials bigint NOT NULL CHECK(fee_rials>=0), UNIQUE(province,max_grams));
CREATE TABLE settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), packaging_grams bigint NOT NULL DEFAULT 200 CHECK(packaging_grams>=0));
INSERT INTO settings(id) VALUES(true);
CREATE TABLE orders (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), idempotency_key text NOT NULL, status text NOT NULL CHECK(status IN ('pending','paid','packing','shipped','cancelled','expired','review')), address jsonb NOT NULL, subtotal_rials bigint NOT NULL, shipping_rials bigint NOT NULL, total_rials bigint NOT NULL, reservation_expires_at timestamptz NOT NULL, tracking text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key));
CREATE INDEX orders_user_idx ON orders(user_id,created_at DESC);
CREATE INDEX orders_expiry_idx ON orders(reservation_expires_at) WHERE status='pending';
CREATE TABLE order_items (order_id text NOT NULL REFERENCES orders(id), product_id text NOT NULL REFERENCES products(id), name text NOT NULL, grams bigint NOT NULL, price_rials bigint NOT NULL, total_rials bigint NOT NULL, PRIMARY KEY(order_id,product_id));
CREATE TABLE payment_attempts (id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id), status text NOT NULL DEFAULT 'pending', provider text NOT NULL, reference text UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stock_movements (id bigserial PRIMARY KEY, product_id text NOT NULL REFERENCES products(id), delta_grams bigint NOT NULL, reason text NOT NULL, order_id text REFERENCES orders(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX stock_movements_product_idx ON stock_movements(product_id);
CREATE TABLE articles (id text PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')), content jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id bigserial PRIMARY KEY, staff_id text REFERENCES staff(id), action text NOT NULL, entity_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE jobs (id bigserial PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX jobs_pending_idx ON jobs(available_at) WHERE status='pending';
CREATE TABLE product_drafts (product_id text PRIMARY KEY REFERENCES products(id), content jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE article_drafts (article_id text PRIMARY KEY REFERENCES articles(id), content jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

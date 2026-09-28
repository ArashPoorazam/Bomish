ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CHECK(role IN ('owner','manager','editor','operator','salesperson'));
ALTER TABLE staff ADD COLUMN full_name text NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN bank_card text NOT NULL DEFAULT '' CHECK(bank_card='' OR bank_card ~ '^[0-9]{16}$');
ALTER TABLE staff ADD COLUMN restrictions text[] NOT NULL DEFAULT '{}';
ALTER TABLE staff ADD COLUMN referral_code text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);
CREATE UNIQUE INDEX staff_referral_code ON staff(referral_code);
ALTER TABLE staff ADD COLUMN archived_at timestamptz;
ALTER TABLE staff ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN referral_staff_id text REFERENCES staff(id);
ALTER TABLE sessions ADD COLUMN referral_seen_at timestamptz;
CREATE TABLE customer_referrals(user_id text PRIMARY KEY REFERENCES users(id),staff_id text NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '720 hours');
CREATE INDEX customer_referrals_staff ON customer_referrals(staff_id,created_at DESC);
ALTER TABLE orders ADD COLUMN paid_at timestamptz;
UPDATE orders SET paid_at=coalesce((SELECT created_at FROM order_events WHERE order_id=orders.id AND status='paid'),created_at) WHERE status IN ('paid','packing','shipped','received');
CREATE TABLE commission_sales(order_id text PRIMARY KEY REFERENCES orders(id),staff_id text NOT NULL REFERENCES staff(id),user_id text NOT NULL REFERENCES users(id),net_rials bigint NOT NULL CHECK(net_rials>=0),commission_rials bigint NOT NULL CHECK(commission_rials>=0),refunded_rials bigint NOT NULL DEFAULT 0 CHECK(refunded_rials>=0 AND refunded_rials<=net_rials),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX commission_sales_staff ON commission_sales(staff_id,created_at DESC);
CREATE TABLE member_ledger(id text PRIMARY KEY,staff_id text NOT NULL REFERENCES staff(id),kind text NOT NULL CHECK(kind IN ('commission','payment','payment_reversal','commission_correction')),amount_rials bigint NOT NULL,order_id text REFERENCES orders(id),reverses_id text UNIQUE REFERENCES member_ledger(id),transaction_number text NOT NULL DEFAULT '',note text NOT NULL DEFAULT '',occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),actor_id text REFERENCES staff(id),idempotency_key text NOT NULL,UNIQUE(staff_id,idempotency_key));
CREATE UNIQUE INDEX member_ledger_sale ON member_ledger(order_id) WHERE kind='commission';
CREATE UNIQUE INDEX member_ledger_bank_reference ON member_ledger(transaction_number) WHERE kind='payment';
CREATE INDEX member_ledger_staff ON member_ledger(staff_id,created_at DESC);
CREATE TABLE price_history(id bigserial PRIMARY KEY,product_id text NOT NULL REFERENCES products(id),package_id text NOT NULL,package_label text NOT NULL,old_rials bigint,new_rials bigint,old_discount bigint,new_discount bigint,actor_id text REFERENCES staff(id),baseline boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX price_history_product ON price_history(product_id,created_at DESC);
CREATE FUNCTION capture_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; oldp jsonb; oldd bigint; newd bigint;
BEGIN
 IF NEW.status <> 'published' THEN RETURN NEW; END IF;
 oldd := coalesce((OLD.content->>'discountPercent')::bigint,0); newd := coalesce((NEW.content->>'discountPercent')::bigint,0);
 FOR p IN SELECT value FROM jsonb_array_elements(coalesce(nullif(NEW.content->'packages','null'::jsonb),'[]')) LOOP
  SELECT value INTO oldp FROM jsonb_array_elements(coalesce(nullif(OLD.content->'packages','null'::jsonb),'[]')) WHERE value->>'id'=p->>'id';
  IF OLD.status <> 'published' OR oldp IS NULL OR oldp->>'priceRials' IS DISTINCT FROM p->>'priceRials' OR oldd<>newd THEN
   INSERT INTO price_history(product_id,package_id,package_label,old_rials,new_rials,old_discount,new_discount,actor_id) VALUES(NEW.id,p->>'id',concat(p->>'amount',' ',p->>'unit'),(oldp->>'priceRials')::bigint,(p->>'priceRials')::bigint,oldd,newd,nullif(current_setting('bomish.actor',true),''));
  END IF;
 END LOOP;
 FOR p IN SELECT value FROM jsonb_array_elements(coalesce(nullif(OLD.content->'packages','null'::jsonb),'[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(NEW.content->'packages','null'::jsonb),'[]')) x WHERE x->>'id'=p->>'id') THEN
   INSERT INTO price_history(product_id,package_id,package_label,old_rials,new_rials,old_discount,new_discount,actor_id) VALUES(NEW.id,p->>'id',concat(p->>'amount',' ',p->>'unit'),(p->>'priceRials')::bigint,NULL,oldd,newd,nullif(current_setting('bomish.actor',true),''));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER product_price_history AFTER UPDATE OF content,status ON products FOR EACH ROW EXECUTE FUNCTION capture_price_history();
INSERT INTO price_history(product_id,package_id,package_label,new_rials,new_discount,baseline) SELECT p.id,x->>'id',concat(x->>'amount',' ',x->>'unit'),(x->>'priceRials')::bigint,coalesce((p.content->>'discountPercent')::bigint,0),true FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(p.content->'packages','null'::jsonb),'[]')) x WHERE p.status='published';
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_kind_check;
ALTER TABLE analytics_events ADD CHECK(kind IN ('view','click','search'));
CREATE INDEX analytics_kind_date_product ON analytics_events(kind,created_at,product_id);
CREATE INDEX audit_created ON audit_events(created_at DESC,id DESC);
CREATE INDEX audit_actor_date ON audit_events(staff_id,created_at DESC);
CREATE INDEX audit_action ON audit_events(action);
CREATE INDEX audit_search ON audit_events USING gin((action||' '||entity_id) gin_trgm_ops);
CREATE INDEX orders_paid_date ON orders(paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX order_items_product_order ON order_items(product_id,order_id);
CREATE INDEX staff_name_search ON staff USING gin((full_name||' '||username||' '||phone) gin_trgm_ops);
CREATE TABLE report_exports(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES staff(id),params jsonb NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','ready','failed')),progress integer NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0,content bytea,error text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX report_exports_pending ON report_exports(created_at) WHERE status IN ('pending','running');
-- Allocate order coupons in whole toman with a cumulative allocation so totals reconcile exactly.
CREATE VIEW analytics_order_lines AS
SELECT oi.*,o.user_id,o.paid_at,o.status,
 oi.total_rials - CASE WHEN o.subtotal_rials>0 THEN
 (floor(sum(oi.total_rials) OVER w * o.discount_rials::numeric / o.subtotal_rials / 10)
 - floor((sum(oi.total_rials) OVER w-oi.total_rials) * o.discount_rials::numeric / o.subtotal_rials / 10))*10 ELSE 0 END::bigint AS net_rials
FROM order_items oi JOIN orders o ON o.id=oi.order_id
WHERE o.paid_at IS NOT NULL AND o.status IN ('paid','packing','shipped','received')
WINDOW w AS(PARTITION BY oi.order_id ORDER BY oi.product_id,oi.package_id ROWS UNBOUNDED PRECEDING);

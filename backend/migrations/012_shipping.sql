-- Additive: existing orders remain legacy postal and existing product weights retain net semantics.
CREATE TABLE shipping_configuration (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), version bigint NOT NULL DEFAULT 1,
 content jsonb NOT NULL DEFAULT '{"mode":"legacy","originRevision":1,"boxes":[],"localities":[],"snapp":{"enabled":false},"tapin":{"enabled":false}}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO shipping_configuration(id) VALUES(true);
CREATE TABLE shipping_configuration_history (version bigint PRIMARY KEY, content jsonb NOT NULL, actor text REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shipping_quotes (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), binding text NOT NULL, config_version bigint NOT NULL,
 snapshot jsonb NOT NULL, expires_at timestamptz NOT NULL, order_id text UNIQUE REFERENCES orders(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipping_quotes_owner ON shipping_quotes(user_id,expires_at);
CREATE TABLE order_shipping (
 order_id text PRIMARY KEY REFERENCES orders(id), version bigint NOT NULL DEFAULT 1,
 method text NOT NULL CHECK(method IN ('snapp','post')), delivery_status text NOT NULL DEFAULT 'not_requested',
 ready boolean NOT NULL DEFAULT false, snapshot jsonb NOT NULL, parcels jsonb NOT NULL,
 actual_cost_rials bigint CHECK(actual_cost_rials>=0), dispatch_quote jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shipment_attempts (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES order_shipping(order_id), idempotency_key text NOT NULL,
 reference text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'submitting', provider_id text NOT NULL DEFAULT '',
 request jsonb NOT NULL, response jsonb, actor text REFERENCES staff(id),
 create_started_at timestamptz, cancel_started_at timestamptz, lease_until timestamptz, lease_token text,
 available_at timestamptz NOT NULL DEFAULT now(), failures integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,idempotency_key)
);
CREATE UNIQUE INDEX shipment_one_unresolved ON shipment_attempts(order_id) WHERE status NOT IN ('cancelled','failed','delivered');
CREATE TABLE delivery_events (
 id bigserial PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), attempt_id text REFERENCES shipment_attempts(id),
 event_key text NOT NULL UNIQUE, status text NOT NULL, external_status text NOT NULL DEFAULT '',
 occurred_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz NOT NULL DEFAULT now(), actor text REFERENCES staff(id)
);
CREATE INDEX delivery_events_order ON delivery_events(order_id,id);
CREATE TABLE shipping_webhooks (
 event_key text PRIMARY KEY, reference text NOT NULL REFERENCES shipment_attempts(reference), received_at timestamptz NOT NULL DEFAULT now(),
 occurred_at timestamptz NOT NULL, processed_at timestamptz
);
-- The simulator is durable across server restarts and is never used for a live request.
CREATE TABLE simulated_shipments (reference text PRIMARY KEY, provider_id text NOT NULL, status text NOT NULL, cost_rials bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE shipment_attempts ADD COLUMN cancel_invoked_at timestamptz;
ALTER TABLE addresses ADD COLUMN province_id text NOT NULL DEFAULT '', ADD COLUMN city_id text NOT NULL DEFAULT '', ADD COLUMN pin_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE order_reads ADD COLUMN last_delivery_event bigint NOT NULL DEFAULT 0;
CREATE FUNCTION shipping_measurements_complete(content jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_array_length(coalesce(nullif(content->'packages','null'),'[]'))>0 AND NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(coalesce(nullif(content->'packages','null'),'[]')) p
 WHERE NOT coalesce((p->>'shippingVerified')::boolean,false)
 OR coalesce((p->>'lengthMm')::bigint,0) NOT BETWEEN 1 AND 3000
 OR coalesce((p->>'widthMm')::bigint,0) NOT BETWEEN 1 AND 3000
 OR coalesce((p->>'heightMm')::bigint,0) NOT BETWEEN 1 AND 3000
 OR coalesce((p->>'shippingGrams')::bigint,0) NOT BETWEEN 1 AND 1000000
 OR (p->>'unit' IN ('g','kg') AND (p->>'shippingGrams')::numeric < (p->>'amount')::numeric * CASE WHEN p->>'unit'='kg' THEN 1000 ELSE 1 END)
 );
$$;

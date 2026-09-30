ALTER TABLE products ADD COLUMN restocked_at timestamptz;
-- Availability can change through publishing as well as the stock switch.
CREATE FUNCTION record_product_restock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF coalesce((OLD.content->>'outOfStock')::boolean,false) AND NOT coalesce((NEW.content->>'outOfStock')::boolean,false) THEN
   NEW.restocked_at = now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_restock BEFORE UPDATE OF content ON products FOR EACH ROW EXECUTE FUNCTION record_product_restock();
CREATE TABLE product_suggestions (product_id text PRIMARY KEY REFERENCES products(id), position integer NOT NULL UNIQUE);
CREATE TABLE customer_requests (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('support','custom')),
 description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 4000),
 quantity text NOT NULL DEFAULT '' CHECK(char_length(quantity)<=200),
 budget_rials bigint NOT NULL DEFAULT 0 CHECK(budget_rials BETWEEN 0 AND 100000000000),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','follow_up','accepted','rejected')),
 response text NOT NULL DEFAULT '' CHECK(char_length(response)<=4000),
 version integer NOT NULL DEFAULT 1,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
CREATE UNIQUE INDEX one_support_conversation ON customer_requests(user_id) WHERE kind='support';
CREATE INDEX customer_requests_owner ON customer_requests(user_id,created_at DESC,id);
CREATE INDEX customer_requests_queue ON customer_requests(kind,updated_at DESC,id);
CREATE TABLE request_messages (
 id bigserial PRIMARY KEY,
 request_id text NOT NULL REFERENCES customer_requests(id),
 staff_id text REFERENCES staff(id),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,idempotency_key)
);
CREATE INDEX request_messages_thread ON request_messages(request_id,id);
CREATE INDEX request_messages_incoming ON request_messages(request_id,id DESC) WHERE staff_id IS NULL;
CREATE TABLE request_reads (
 staff_id text NOT NULL REFERENCES staff(id),
 request_id text NOT NULL REFERENCES customer_requests(id),
 last_message_id bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(staff_id,request_id)
);
CREATE TABLE order_reads (
 staff_id text NOT NULL REFERENCES staff(id),
 order_id text NOT NULL REFERENCES orders(id),
 PRIMARY KEY(staff_id,order_id)
);

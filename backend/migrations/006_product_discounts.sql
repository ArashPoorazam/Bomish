ALTER TABLE discount_codes ADD COLUMN deleted_at timestamptz;

CREATE TABLE product_discounts (
 id text PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 percent bigint NOT NULL CHECK (percent BETWEEN 1 AND 90),
 product_ids text[] NOT NULL CHECK (cardinality(product_ids) > 0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve existing discounts as manageable groups.
INSERT INTO product_discounts(id,name,percent,product_ids)
SELECT 'existing-' || percent::text, 'تخفیف قبلی ' || percent::text || '٪', percent, array_agg(id ORDER BY id)
FROM (
 SELECT p.id, greatest(coalesce((p.content->>'discountPercent')::bigint,0),
 coalesce((d.content->>'discountPercent')::bigint,0)) AS percent
 FROM products p LEFT JOIN product_drafts d ON d.product_id=p.id
) existing WHERE percent > 0 GROUP BY percent;

CREATE FUNCTION product_discount_percent(product_id text) RETURNS bigint
LANGUAGE sql STABLE AS $$
 SELECT coalesce(max(percent),0) FROM product_discounts
 WHERE active AND product_id=ANY(product_ids)
$$;

-- Product saves must not overwrite a managed discount with stale editor data.
CREATE FUNCTION sync_product_discount() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
 IF TG_TABLE_NAME='product_drafts' THEN target_id := NEW.product_id;
 ELSE target_id := NEW.id; END IF;
 NEW.content := jsonb_set(NEW.content,'{discountPercent}',to_jsonb(product_discount_percent(target_id)),true);
 RETURN NEW;
END
$$;
CREATE TRIGGER product_discount_content BEFORE INSERT OR UPDATE OF content ON products
FOR EACH ROW EXECUTE FUNCTION sync_product_discount();
CREATE TRIGGER product_discount_draft BEFORE INSERT OR UPDATE OF content ON product_drafts
FOR EACH ROW EXECUTE FUNCTION sync_product_discount();
UPDATE products SET content=content;
UPDATE product_drafts SET content=content;

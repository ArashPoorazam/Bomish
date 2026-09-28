-- Preserve the last unavailable state when moving away from counted inventory.
-- Historic stock tables remain as a read-only record; application code no longer uses them.
UPDATE products p SET content=jsonb_set(p.content,'{outOfStock}',to_jsonb(i.stock_grams-i.reserved_grams<=0))
FROM inventory i WHERE i.product_id=p.id AND NOT p.content ? 'outOfStock';
UPDATE product_drafts d SET content=jsonb_set(d.content,'{outOfStock}',coalesce(p.content->'outOfStock','false'::jsonb))
FROM products p WHERE p.id=d.product_id;

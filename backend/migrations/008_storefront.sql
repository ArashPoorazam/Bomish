ALTER TABLE products ADD COLUMN first_published_at timestamptz;
UPDATE products p SET first_published_at = history.first_published_at
FROM (SELECT entity_id, min(created_at) AS first_published_at FROM audit_events WHERE action='product.publish' GROUP BY entity_id) history
WHERE p.id=history.entity_id;
CREATE INDEX products_first_published ON products(first_published_at DESC, id) WHERE status='published';

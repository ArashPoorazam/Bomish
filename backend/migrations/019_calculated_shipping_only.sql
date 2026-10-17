-- Retire the checkout mode switch without changing historical orders or invoices.
ALTER TABLE shipping_configuration ALTER COLUMN content SET DEFAULT
'{"originRevision":1,"boxes":[],"localities":[],"snapp":{"enabled":false},"tapin":{"enabled":false}}';
UPDATE shipping_configuration
SET version = version + 1, content = content - 'mode', updated_at = now()
WHERE content ? 'mode';
INSERT INTO shipping_configuration_history(version, content)
SELECT version, content FROM shipping_configuration
ON CONFLICT (version) DO NOTHING;

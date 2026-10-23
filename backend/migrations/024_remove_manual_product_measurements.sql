SELECT pg_advisory_xact_lock(hashtextextended('product-packaging-sync', 0));

UPDATE products
SET content = jsonb_set(content, '{packages}', (
    SELECT jsonb_agg(
        CASE WHEN coalesce(pack->>'packagingId', '') = '' THEN
            (pack - ARRAY['packaging', 'netGrams', 'lengthMm', 'widthMm', 'heightMm'])
            || '{"shippingGrams":0,"shippingVerified":false}'::jsonb
        ELSE pack END ORDER BY position
    )
    FROM jsonb_array_elements(content->'packages') WITH ORDINALITY AS variants(pack, position)
)), updated_at = now()
WHERE jsonb_typeof(content->'packages') = 'array'
    AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(content->'packages') = 'array' THEN content->'packages' ELSE '[]'::jsonb END) pack
        WHERE coalesce(pack->>'packagingId', '') = ''
    );

UPDATE product_drafts
SET content = jsonb_set(content, '{packages}', (
    SELECT jsonb_agg(
        CASE WHEN coalesce(pack->>'packagingId', '') = '' THEN
            (pack - ARRAY['packaging', 'netGrams', 'lengthMm', 'widthMm', 'heightMm'])
            || '{"shippingGrams":0,"shippingVerified":false}'::jsonb
        ELSE pack END ORDER BY position
    )
    FROM jsonb_array_elements(content->'packages') WITH ORDINALITY AS variants(pack, position)
)), updated_at = now()
WHERE jsonb_typeof(content->'packages') = 'array'
    AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(content->'packages') = 'array' THEN content->'packages' ELSE '[]'::jsonb END) pack
        WHERE coalesce(pack->>'packagingId', '') = ''
    );

-- Repair databases that applied migration 012 before these additions existed.
-- Keep this forward migration safe for databases with the complete 012 schema.
ALTER TABLE order_reads
    ADD COLUMN IF NOT EXISTS last_delivery_event bigint NOT NULL DEFAULT 0;

-- Match the completeness rules from 012, including net-to-shipping weight checks.
CREATE OR REPLACE FUNCTION shipping_measurements_complete (content jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    AS $$
    SELECT
        jsonb_array_length(coalesce(nullif (content -> 'packages', 'null'), '[]')) > 0
        AND NOT EXISTS (
            SELECT
                1
            FROM
                jsonb_array_elements(coalesce(nullif (content -> 'packages', 'null'), '[]')) p
            WHERE
                NOT coalesce((p ->> 'shippingVerified')::boolean, FALSE)
                OR coalesce((p ->> 'lengthMm')::bigint, 0)
                NOT BETWEEN 1 AND 3000
                OR coalesce((p ->> 'widthMm')::bigint, 0)
                NOT BETWEEN 1 AND 3000
                OR coalesce((p ->> 'heightMm')::bigint, 0)
                NOT BETWEEN 1 AND 3000
                OR coalesce((p ->> 'shippingGrams')::bigint, 0)
                NOT BETWEEN 1 AND 1000000
                OR (p ->> 'unit' IN ('g', 'kg')
                    AND (p ->> 'shippingGrams')::numeric < (p ->> 'amount')::numeric * CASE WHEN p ->> 'unit' = 'kg' THEN
                        1000
                    ELSE
                        1
                    END));
$$;


-- Resolve public product links by slug or ID; drafts and archived products stay hidden.
-- A missing availability flag defaults to in stock for legacy content.
-- name: GetPublicProduct :one
SELECT
    sqlc.embed(p),
    coalesce((p.content ->> 'outOfStock')::boolean, false)::boolean AS out_of_stock
FROM products p
WHERE (p.slug = $1 OR p.id = $1)
    AND p.status = 'published';

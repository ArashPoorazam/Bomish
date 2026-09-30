-- name: ListCategories :many
SELECT * FROM categories ORDER BY name;

-- name: GetPublicProduct :one
SELECT sqlc.embed(p), coalesce((p.content->>'outOfStock')::boolean,false)::boolean AS out_of_stock FROM products p WHERE (p.slug=$1 OR p.id=$1) AND p.status='published';

-- name: ListPublicArticles :many
SELECT * FROM articles WHERE status='published' ORDER BY updated_at DESC;

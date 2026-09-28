-- name: ListCategories :many
SELECT * FROM categories ORDER BY name;

-- name: ListPublicProducts :many
SELECT p.*, coalesce((p.content->>'outOfStock')::boolean,false) AS out_of_stock FROM products p
WHERE p.status='published' AND (sqlc.arg(category)::text='' OR p.category_id=sqlc.arg(category))
AND (sqlc.arg(query)::text='' OR p.search_text LIKE '%'||sqlc.arg(query)||'%' OR similarity(p.search_text,sqlc.arg(query))>0.12)
ORDER BY CASE WHEN p.search_text=sqlc.arg(query) THEN 0 WHEN p.search_text LIKE sqlc.arg(query)||'%' THEN 1 ELSE 2 END, similarity(p.search_text,sqlc.arg(query)) DESC, p.name LIMIT 200;

-- name: GetPublicProduct :one
SELECT p.*, coalesce((p.content->>'outOfStock')::boolean,false) AS out_of_stock FROM products p WHERE (p.slug=$1 OR p.id=$1) AND p.status='published';

-- name: ListPublicArticles :many
SELECT * FROM articles WHERE status='published' ORDER BY updated_at DESC;

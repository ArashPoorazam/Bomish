-- Show published articles with the most recently updated content first.
-- name: ListPublicArticles :many
SELECT *
FROM articles
WHERE status = 'published'
ORDER BY updated_at DESC;

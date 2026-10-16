-- Category labels for storefront navigation, sorted by name.
-- name: ListCategories :many
SELECT *
FROM categories
ORDER BY name;

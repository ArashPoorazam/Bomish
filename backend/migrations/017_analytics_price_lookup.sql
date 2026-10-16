-- Daily price carry-forward looks up the latest event for one package at a time.
CREATE INDEX price_history_package_day ON price_history (product_id, package_id, created_at DESC, id DESC);

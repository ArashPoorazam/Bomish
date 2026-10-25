-- Order pages and SMS read the latest courier attempt with deterministic ties.
CREATE INDEX shipment_attempts_order_latest ON shipment_attempts (order_id, created_at DESC, id DESC);

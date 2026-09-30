-- Latest-event markers are polled independently of unread counts.
CREATE INDEX customer_requests_newest ON customer_requests(kind,created_at DESC);
CREATE INDEX orders_newest ON orders(created_at DESC);
CREATE INDEX request_messages_newest_incoming ON request_messages(id DESC) WHERE staff_id IS NULL;

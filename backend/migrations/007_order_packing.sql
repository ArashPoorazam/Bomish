-- Track packing progress independently for each order line.
ALTER TABLE order_items
    ADD COLUMN packed boolean NOT NULL DEFAULT FALSE;


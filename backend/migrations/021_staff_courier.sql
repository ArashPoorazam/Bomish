ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
    CHECK (role IN ('owner', 'manager', 'editor', 'operator', 'salesperson', 'courier'));

-- Keep the checkout method/quote intact; fulfillment may use a staff courier.
-- Snapshot identity so later profile edits or archiving do not rewrite history.
ALTER TABLE order_shipping
    ADD COLUMN courier_staff_id text REFERENCES staff(id),
    ADD COLUMN courier_name text NOT NULL DEFAULT '',
    ADD COLUMN courier_phone text NOT NULL DEFAULT '',
    ADD CONSTRAINT own_courier_shipping CHECK (
        courier_staff_id IS NULL OR
        (method = 'snapp' AND courier_name <> '' AND ready AND delivery_status IN ('picked_up', 'delivered'))
    );

CREATE INDEX order_shipping_courier ON order_shipping(courier_staff_id)
    WHERE courier_staff_id IS NOT NULL;

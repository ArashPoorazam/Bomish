ALTER TABLE staff ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(permission_overrides) = 'object');

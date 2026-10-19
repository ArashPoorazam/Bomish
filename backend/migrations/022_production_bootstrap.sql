-- Storefront navigation depends on these stable identifiers. Preserve merchant edits.
INSERT INTO categories(id,name) VALUES
    ('spices','ادویه‌ها'), ('herbs','سبزی‌های خشک'), ('seeds','دانه‌های خوراکی')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sessions ADD COLUMN omnisire_verified boolean NOT NULL DEFAULT false;
-- Password-only staff login; only owners retain an authenticator.
UPDATE staff SET totp_secret='', last_totp_step=0 WHERE role <> 'owner';
-- Existing staff sessions must authenticate under the new access policy.
DELETE FROM sessions WHERE staff_id IS NOT NULL;

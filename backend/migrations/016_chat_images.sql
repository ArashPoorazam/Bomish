ALTER TABLE request_messages ADD COLUMN image bytea CHECK (octet_length(image) <= 5242880);

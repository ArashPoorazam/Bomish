CREATE TABLE product_packaging (
    id text PRIMARY KEY,
    content jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

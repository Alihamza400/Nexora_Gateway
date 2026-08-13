-- UP
ALTER TABLE merchants ADD COLUMN email VARCHAR(255) UNIQUE;
ALTER TABLE merchants ADD COLUMN password_hash VARCHAR(255);
ALTER TABLE merchants ADD COLUMN password_salt VARCHAR(255);

-- Make existing fields nullable for backwards compatibility
ALTER TABLE merchants ALTER COLUMN api_key_hash DROP NOT NULL;

CREATE INDEX idx_merchants_email ON merchants(email);

-- DOWN
DROP INDEX IF EXISTS idx_merchants_email;
ALTER TABLE merchants DROP COLUMN IF EXISTS email;
ALTER TABLE merchants DROP COLUMN IF EXISTS password_hash;
ALTER TABLE merchants DROP COLUMN IF EXISTS password_salt;
ALTER TABLE merchants ALTER COLUMN api_key_hash SET NOT NULL;

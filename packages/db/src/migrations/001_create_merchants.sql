-- UP
CREATE TABLE merchants (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  settlement_asset VARCHAR(20) NOT NULL,
  settlement_chain VARCHAR(20) NOT NULL,
  settlement_address VARCHAR(255) NOT NULL,
  accepted_chains TEXT[] NOT NULL DEFAULT '{}',
  accepted_assets TEXT[] NOT NULL DEFAULT '{}',
  fee_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
  kyc_threshold DECIMAL(20, 8) NOT NULL DEFAULT 10000,
  quote_ttl_seconds INTEGER NOT NULL DEFAULT 300,
  webhook_url VARCHAR(500),
  api_key_hash VARCHAR(255) NOT NULL,
  compliance_status VARCHAR(20) NOT NULL DEFAULT 'COMPLIANT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_compliance ON merchants(compliance_status);

-- DOWN
DROP TABLE IF EXISTS merchants;

-- UP
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES payment_intents(id),
  merchant_id VARCHAR(255) NOT NULL REFERENCES merchants(id),
  amount DECIMAL(20, 8) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  destination_address VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  tx_hash VARCHAR(255),
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_settlements_intent ON settlements(intent_id);
CREATE INDEX idx_settlements_merchant ON settlements(merchant_id);
CREATE INDEX idx_settlements_status ON settlements(status);

-- DOWN
DROP TABLE IF EXISTS settlements;

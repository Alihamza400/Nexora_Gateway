-- UP
CREATE TABLE recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_intent_id UUID REFERENCES payment_intents(id),
  case_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DETECTED',
  customer_address VARCHAR(255) NOT NULL,
  customer_chain VARCHAR(20) NOT NULL,
  intended_chain VARCHAR(20) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  tx_hash VARCHAR(255),
  resolution_action VARCHAR(30),
  resolution_tx_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_recovery_status ON recovery_cases(status);
CREATE INDEX idx_recovery_intent ON recovery_cases(related_intent_id);
CREATE INDEX idx_recovery_customer ON recovery_cases(customer_address);

-- DOWN
DROP TABLE IF EXISTS recovery_cases;

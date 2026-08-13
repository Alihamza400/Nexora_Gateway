-- UP
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id VARCHAR(255) NOT NULL REFERENCES merchants(id),
  order_ref VARCHAR(255) NOT NULL,
  target_amount DECIMAL(20, 8) NOT NULL,
  target_asset VARCHAR(20) NOT NULL,
  target_chain VARCHAR(20) NOT NULL,
  accepted_assets TEXT[] NOT NULL DEFAULT '{}',
  quoted_rate DECIMAL(20, 8),
  quote_expires_at TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intents_merchant ON payment_intents(merchant_id);
CREATE INDEX idx_intents_state ON payment_intents(state);
CREATE INDEX idx_intents_order_ref ON payment_intents(order_ref);
CREATE INDEX idx_intents_created ON payment_intents(created_at);
CREATE INDEX idx_intents_quote_expires ON payment_intents(quote_expires_at) WHERE quote_expires_at IS NOT NULL;

-- DOWN
DROP TABLE IF EXISTS payment_intents;

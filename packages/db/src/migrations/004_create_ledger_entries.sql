-- UP
-- Double-entry ledger for all financial movements.
-- Every transaction has a debit and credit entry.
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  debit_account VARCHAR(255) NOT NULL,
  credit_account VARCHAR(255) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_intent ON ledger_entries(intent_id);
CREATE INDEX idx_ledger_debit ON ledger_entries(debit_account);
CREATE INDEX idx_ledger_credit ON ledger_entries(credit_account);
CREATE INDEX idx_ledger_type ON ledger_entries(entry_type);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at);

-- DOWN
DROP TABLE IF EXISTS ledger_entries;

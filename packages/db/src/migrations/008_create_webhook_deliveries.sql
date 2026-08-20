-- UP
-- Track webhook delivery attempts for idempotency and retry logic.
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  webhook_url VARCHAR(500) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(intent_id, event_type)
);

CREATE INDEX idx_webhook_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_retry ON webhook_deliveries(next_retry_at) WHERE status = 'PENDING';

-- DOWN
DROP TABLE IF EXISTS webhook_deliveries;

-- UP
-- Append-only audit trail for all payment intent state transitions.
-- Never update or delete rows in this table.
CREATE TABLE intent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES payment_intents(id),
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_intent ON intent_events(intent_id);
CREATE INDEX idx_events_type ON intent_events(event_type);
CREATE INDEX idx_events_created ON intent_events(created_at);

-- Prevent updates and deletes on this table (append-only)
CREATE OR REPLACE FUNCTION prevent_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_events table is append-only. Updates and deletes are not allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_event_update
  BEFORE UPDATE ON intent_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_event_modification();

CREATE TRIGGER trg_prevent_event_delete
  BEFORE DELETE ON intent_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_event_modification();

-- DOWN
DROP TRIGGER IF EXISTS trg_prevent_event_delete ON intent_events;
DROP TRIGGER IF EXISTS trg_prevent_event_update ON intent_events;
DROP FUNCTION IF EXISTS prevent_event_modification();
DROP TABLE IF EXISTS intent_events;

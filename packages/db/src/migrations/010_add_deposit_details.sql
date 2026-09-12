-- UP
-- Persist deposit routing details on the intent itself.
--
-- Until now the deposit address existed only inside the QUOTE_GENERATED event
-- payload. The deposit watcher needs to answer "which intent does this incoming
-- transfer belong to?" for every transfer it sees, and answering that by parsing
-- the event log would mean scanning JSONB per block. Storing the pair on the
-- intent, with an index, makes it a single indexed lookup.
--
-- This also closes a type/runtime mismatch: PaymentIntent.deposit_address was
-- declared as a string but no column backed it, so the value was always
-- undefined at runtime.
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS deposit_address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deposit_asset VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deposit_chain VARCHAR(20);

-- Backfill from the most recent QUOTE_GENERATED event for each intent, so
-- existing rows become watchable rather than needing to be re-quoted.
UPDATE payment_intents pi
SET deposit_address = latest.payload ->> 'deposit_address',
    deposit_asset   = latest.payload ->> 'deposit_asset',
    deposit_chain   = latest.payload ->> 'deposit_chain'
FROM (
  SELECT DISTINCT ON (intent_id) intent_id, payload
  FROM intent_events
  WHERE event_type = 'QUOTE_GENERATED'
  ORDER BY intent_id, created_at DESC
) AS latest
WHERE pi.id = latest.intent_id
  AND pi.deposit_address IS NULL;

-- Hot path: the watcher resolves every observed transfer through this index.
CREATE INDEX IF NOT EXISTS idx_intents_deposit_lookup
  ON payment_intents(deposit_chain, deposit_address)
  WHERE deposit_address IS NOT NULL;

-- Supports the watcher's "what should I be watching right now" query.
CREATE INDEX IF NOT EXISTS idx_intents_awaiting_deposit
  ON payment_intents(state)
  WHERE deposit_address IS NOT NULL
    AND state IN ('QUOTED', 'AWAITING_PAYMENT', 'UNDERPAID');

-- DOWN
DROP INDEX IF EXISTS idx_intents_awaiting_deposit;
DROP INDEX IF EXISTS idx_intents_deposit_lookup;
ALTER TABLE payment_intents
  DROP COLUMN IF EXISTS deposit_address,
  DROP COLUMN IF EXISTS deposit_asset,
  DROP COLUMN IF EXISTS deposit_chain;

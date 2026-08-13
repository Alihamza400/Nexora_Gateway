-- UP
-- Cached price data from external oracles (CoinGecko, Chainlink, etc.)
CREATE TABLE price_oracles (
  id SERIAL PRIMARY KEY,
  asset VARCHAR(20) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  price DECIMAL(20, 8) NOT NULL,
  source VARCHAR(50) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset, currency)
);

CREATE INDEX idx_price_asset ON price_oracles(asset, currency);

-- DOWN
DROP TABLE IF EXISTS price_oracles;

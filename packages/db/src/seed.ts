import { query } from './connection.js';

/**
 * Seed the database with development data.
 */
export async function seed(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Insert test merchant
  await query(`
    INSERT INTO merchants (id, name, settlement_asset, settlement_chain, settlement_address, accepted_chains, accepted_assets, fee_percentage, kyc_threshold, quote_ttl_seconds, webhook_url, api_key_hash)
    VALUES
      ('merchant-001', 'Test Shop', 'USDC', '1', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', ARRAY['1', '8453', '42161'], ARRAY['USDC', 'USDT', 'ETH'], 1.0, 10000, 300, 'https://webhook.example.com/test', 'hash_of_test_api_key'),
      ('merchant-002', 'Crypto Store', 'USDT', '137', '0x1234567890abcdef1234567890abcdef12345678', ARRAY['1', '8453', '137'], ARRAY['USDC', 'USDT'], 0.5, 50000, 120, 'https://webhook.example.com/store', 'hash_of_store_api_key')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Insert test price oracle rates
  await query(`
    INSERT INTO price_oracles (asset, currency, price, source, updated_at)
    VALUES
      ('USDC', 'USD', 1.0, 'coingecko', NOW()),
      ('USDT', 'USD', 1.0, 'coingecko', NOW()),
      ('ETH', 'USD', 3500.0, 'coingecko', NOW()),
      ('SOL', 'USD', 150.0, 'coingecko', NOW()),
      ('TRX', 'USD', 0.12, 'coingecko', NOW())
    ON CONFLICT (asset, currency) DO UPDATE SET price = EXCLUDED.price, updated_at = NOW();
  `);

  console.log('✅ Seed data inserted');
}

// Run if executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

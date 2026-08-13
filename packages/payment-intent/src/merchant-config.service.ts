import { query } from '@crypto-gateway/db';
import { MerchantConfig } from '@crypto-gateway/shared';

/**
 * Merchant Configuration Service
 * Manages merchant-specific settings and configuration.
 */
export class MerchantConfigService {
  /**
   * Get merchant by ID.
   */
  async getById(id: string): Promise<MerchantConfig | null> {
    const result = await query<MerchantConfig>(
      `SELECT * FROM merchants WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Get merchant by API key hash.
   */
  async getByApiKeyHash(apiKeyHash: string): Promise<MerchantConfig | null> {
    const result = await query<MerchantConfig>(
      `SELECT * FROM merchants WHERE api_key_hash = $1`,
      [apiKeyHash],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Get all active merchants.
   */
  async getAll(): Promise<MerchantConfig[]> {
    const result = await query<MerchantConfig>(
      `SELECT * FROM merchants WHERE compliance_status = 'COMPLIANT' ORDER BY name`,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Check if a merchant is compliant.
   */
  async isCompliant(merchantId: string): Promise<boolean> {
    const merchant = await this.getById(merchantId);
    return merchant?.compliance_status === 'COMPLIANT';
  }

  /**
   * Map a database row to a MerchantConfig object.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRow(row: any): MerchantConfig {
    return {
      id: String(row.id),
      name: String(row.name),
      settlement_asset: String(row.settlement_asset),
      settlement_chain: String(row.settlement_chain),
      settlement_address: String(row.settlement_address),
      accepted_chains: row.accepted_chains as string[],
      accepted_assets: row.accepted_assets as string[],
      fee_percentage: parseFloat(String(row.fee_percentage)),
      kyc_threshold: parseFloat(String(row.kyc_threshold)),
      quote_ttl_seconds: Number(row.quote_ttl_seconds),
      webhook_url: row.webhook_url ? String(row.webhook_url) : null,
      compliance_status: String(row.compliance_status),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

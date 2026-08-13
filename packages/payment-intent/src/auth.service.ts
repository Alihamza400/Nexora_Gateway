import crypto from 'crypto';
import { query } from '@crypto-gateway/db';

/**
 * Auth Service
 * Handles merchant registration, login, and API key management.
 */

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  settlement_asset?: string;
  settlement_chain?: string;
  settlement_address?: string;
  accepted_chains?: string[];
  accepted_assets?: string[];
  webhook_url?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  merchant_id: string;
  name: string;
  email: string;
  api_key: string;
  token: string;
}

export interface Merchant {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  password_salt: string;
  api_key_hash: string;
  settlement_asset: string;
  settlement_chain: string;
  settlement_address: string;
  accepted_chains: string[];
  accepted_assets: string[];
  fee_percentage: number;
  kyc_threshold: number;
  quote_ttl_seconds: number;
  webhook_url: string | null;
  compliance_status: string;
  created_at: Date;
  updated_at: Date;
}

export class AuthService {
  /**
   * Hash a password using PBKDF2.
   */
  private hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const useSalt = salt || crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, useSalt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt: useSalt };
  }

  /**
   * Generate a random API key.
   */
  private generateApiKey(): string {
    return `nxt_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Hash an API key for storage.
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Generate a simple JWT-like token (for demo purposes).
   * In production, use proper JWT library.
   */
  private generateToken(merchantId: string): string {
    const payload = {
      merchant_id: merchantId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Register a new merchant.
   */
  async register(data: RegisterRequest): Promise<AuthResponse> {
    // Check if email already exists
    const existing = await query<Merchant>(
      'SELECT id FROM merchants WHERE email = $1',
      [data.email],
    );

    if (existing.rows.length > 0) {
      throw new Error('Email already registered');
    }

    // Validate required fields
    if (!data.name || !data.email || !data.password) {
      throw new Error('Name, email, and password are required');
    }

    if (data.password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Hash password and generate API key
    const { hash: passwordHash, salt } = this.hashPassword(data.password);
    const apiKey = this.generateApiKey();
    const apiKeyHash = this.hashApiKey(apiKey);

    // Create merchant
    const merchantId = crypto.randomUUID();
    const result = await query<Merchant>(
      `INSERT INTO merchants (
        id, name, email, password_hash, password_salt, api_key_hash,
        settlement_asset, settlement_chain, settlement_address,
        accepted_chains, accepted_assets, fee_percentage, kyc_threshold,
        quote_ttl_seconds, webhook_url, compliance_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        merchantId,
        data.name,
        data.email,
        passwordHash,
        salt,
        apiKeyHash,
        data.settlement_asset || 'USDC',
        data.settlement_chain || '1',
        data.settlement_address || '0x0000000000000000000000000000000000000000',
        data.accepted_chains || ['1', '8453', '42161', '137'],
        data.accepted_assets || ['USDC', 'USDT', 'ETH'],
        1.0, // fee_percentage
        10000, // kyc_threshold
        300, // quote_ttl_seconds
        data.webhook_url || null,
        'PENDING', // compliance_status
      ],
    );

    const merchant = result.rows[0]!;
    const token = this.generateToken(merchant.id);

    return {
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      api_key: apiKey, // Return raw key only on registration
      token,
    };
  }

  /**
   * Login with email and password.
   */
  async login(data: LoginRequest): Promise<AuthResponse> {
    if (!data.email || !data.password) {
      throw new Error('Email and password are required');
    }

    // Find merchant by email
    const result = await query<Merchant & { password_salt: string }>(
      'SELECT * FROM merchants WHERE email = $1',
      [data.email],
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const merchant = result.rows[0]!;

    // Verify password
    const { hash } = this.hashPassword(data.password, merchant.password_salt);
    if (hash !== merchant.password_hash) {
      throw new Error('Invalid email or password');
    }

    // Generate token
    const token = this.generateToken(merchant.id);

    return {
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      api_key: '', // Don't return API key on login
      token,
    };
  }

  /**
   * Validate an API key and return the merchant.
   */
  async validateApiKey(apiKey: string): Promise<Merchant | null> {
    const apiKeyHash = this.hashApiKey(apiKey);

    const result = await query<Merchant>(
      'SELECT * FROM merchants WHERE api_key_hash = $1 AND compliance_status = $2',
      [apiKeyHash, 'COMPLIANT'],
    );

    return result.rows[0] || null;
  }

  /**
   * Validate a token and return the merchant.
   */
  async validateToken(token: string): Promise<Merchant | null> {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64').toString());

      // Check expiration
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      const result = await query<Merchant>(
        'SELECT * FROM merchants WHERE id = $1',
        [payload.merchant_id],
      );

      return result.rows[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Regenerate API key for a merchant.
   */
  async regenerateApiKey(merchantId: string): Promise<string> {
    const apiKey = this.generateApiKey();
    const apiKeyHash = this.hashApiKey(apiKey);

    await query(
      'UPDATE merchants SET api_key_hash = $1, updated_at = NOW() WHERE id = $2',
      [apiKeyHash, merchantId],
    );

    return apiKey;
  }

  /**
   * Get merchant profile.
   */
  async getProfile(merchantId: string): Promise<Omit<Merchant, 'password_hash' | 'password_salt' | 'api_key_hash'> | null> {
    const result = await query<Merchant>(
      'SELECT * FROM merchants WHERE id = $1',
      [merchantId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const merchant = result.rows[0];
    const { password_hash: _, password_salt: __, api_key_hash: ___, ...profile } = merchant as any;
    return profile;
  }
}

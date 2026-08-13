/**
 * Routing Engine Types
 * Route selection and optimization interfaces.
 */

// ─── Route Quote ─────────────────────────────────────────────────────────────

export interface RouteQuote {
  id: string;
  provider: string;
  source_chain: string;
  source_asset: string;
  source_amount: number;
  target_chain: string;
  target_asset: string;
  target_amount: number;
  steps: RouteStep[];
  estimated_fee: number;
  estimated_time: number;
  security_score: number;
  reliability_score: number;
  expires_at: Date;
}

export interface RouteStep {
  chain: string;
  protocol: string;
  action: string;
  input_amount: number;
  output_amount: number;
  fee: number;
}

// ─── Route Quote Params ──────────────────────────────────────────────────────

export interface RouteQuoteParams {
  source_chain: string;
  source_asset: string;
  source_amount: number;
  target_chain: string;
  target_asset: string;
  target_amount: number;
}

// ─── Route Score ─────────────────────────────────────────────────────────────

export interface RouteScore {
  total_score: number;
  fee_score: number;
  time_score: number;
  security_score: number;
  reliability_score: number;
}

// ─── Route Execution ─────────────────────────────────────────────────────────

export type RouteStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

export interface RouteExecutionResult {
  execution_id: string;
  status: RouteStatus;
  transaction_hashes: string[];
  actual_fee: number;
  actual_time: number;
}

// ─── Route Provider Interface ────────────────────────────────────────────────

export interface IRouteProvider {
  getName(): string;
  quote(params: RouteQuoteParams): Promise<RouteQuote>;
  execute(route: RouteQuote): Promise<RouteExecutionResult>;
  getStatus(executionId: string): Promise<RouteStatus>;
  getSupportedChains(): string[];
  getSupportedAssets(chain: string): string[];
}

// ─── Merchant Preferences ────────────────────────────────────────────────────

export interface MerchantPreferences {
  max_fee: number;
  max_time: number;
  fee_weight: number;
  time_weight: number;
  security_weight: number;
  reliability_weight: number;
}

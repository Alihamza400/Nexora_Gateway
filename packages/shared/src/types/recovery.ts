/**
 * Recovery Types
 * Failure mode handling types.
 */

// ─── Recovery Case ───────────────────────────────────────────────────────────

export type RecoveryCaseType = 'MISDIRECTED' | 'UNDERPAID' | 'OVERPAID' | 'STUCK';

export type RecoveryStatus = 'DETECTED' | 'VERIFYING' | 'RESOLVING' | 'RESOLVED' | 'FAILED';

export type ResolutionAction =
  | 'AUTO_REFUND'
  | 'AUTO_CREDIT'
  | 'TOP_UP_LINK'
  | 'RE_QUOTE'
  | 'FEE_BUMP'
  | 'RELAYER_ACCELERATION';

export interface RecoveryCase {
  id: string;
  related_intent_id: string | null;
  case_type: RecoveryCaseType;
  status: RecoveryStatus;
  customer_address: string;
  customer_chain: string;
  intended_chain: string;
  asset: string;
  amount: number;
  tx_hash: string | null;
  resolution_action: ResolutionAction | null;
  resolution_tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

// ─── Top Up Link ─────────────────────────────────────────────────────────────

export interface TopUpLink {
  id: string;
  recovery_case_id: string;
  amount: number;
  asset: string;
  chain: string;
  address: string;
  expires_at: Date;
  created_at: Date;
}

// ─── Ownership Proof ─────────────────────────────────────────────────────────

export interface OwnershipProof {
  address: string;
  signature: string;
  message: string;
  verified: boolean;
  verified_at: Date | null;
}

// ─── Resolution Result ───────────────────────────────────────────────────────

export interface ResolutionResult {
  action: ResolutionAction;
  success: boolean;
  tx_hash: string | null;
  message: string;
}

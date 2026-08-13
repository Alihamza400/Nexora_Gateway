/**
 * Gas Abstraction Layer
 * Provides gasless transaction support across multiple chains.
 */

// Core service
export { GasAbstractionService } from './gas-abstraction.service.js';

// Re-export shared types
export type {
  IGasAbstraction,
  GasAbstractionStrategy,
  GasCostEstimate,
  GaslessFee,
  PaymasterRequest,
  PaymasterResult,
  PaymasterConfig,
  SponsorPolicy,
  RelayerRequest,
  RelayerResult,
  RelayerConfig,
  RelayerTransaction,
  UserOperation,
  GaslessExecutionResult,
} from '@crypto-gateway/shared';

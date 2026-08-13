/**
 * Rate Lock & Risk Engine Package
 * Provides rate locking, price oracle integration, and risk scoring.
 */

// Price Oracle
export {
  CoinGeckoOracle,
  ChainlinkOracle,
  PriceOracleAggregator,
} from './price-oracle.service.js';

// Rate Lock
export {
  RateLockService,
  RateLockCleanupService,
} from './rate-lock.service.js';

// Risk Scoring
export {
  BasicRiskScorer,
  InMemorySanctionsProvider,
} from './basic-risk-scorer.js';

// Compliance Gate
export { ComplianceGate } from './compliance-gate.js';

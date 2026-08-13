/**
 * Routing Engine
 * Path selection, optimization, and execution.
 */

// Core engine
export { RouteEngine } from './route-engine.js';
export type { RouteEngineConfig } from './route-engine.js';

// Scoring
export { RouteScorer, DEFAULT_PREFERENCES } from './route-scorer.js';

// Circuit breaker
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export type { CircuitState, CircuitBreakerOptions } from './circuit-breaker.js';

// Provider management
export { ProviderRegistry } from './provider-registry.js';
export { BaseRouteProvider, isCircuitOpenError } from './base-route-provider.js';

// Mock providers (for testing/development)
export { MockLiFiProvider } from './providers/mock-lifi-provider.js';
export type { MockLiFiConfig } from './providers/mock-lifi-provider.js';
export { MockSocketProvider } from './providers/mock-socket-provider.js';
export type { MockSocketConfig } from './providers/mock-socket-provider.js';

// Re-export shared types
export type {
  IRouteProvider,
  RouteQuote,
  RouteQuoteParams,
  RouteStep,
  RouteScore,
  RouteExecutionResult,
  RouteStatus,
  MerchantPreferences,
} from '@crypto-gateway/shared';

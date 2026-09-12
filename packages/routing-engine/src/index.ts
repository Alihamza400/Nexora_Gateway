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

// Real providers (production)
export { LifiRouteProvider } from './providers/lifi-route-provider.js';
export type { LifiProviderConfig } from './providers/lifi-route-provider.js';
export { SocketRouteProvider } from './providers/socket-route-provider.js';
export type { SocketProviderConfig } from './providers/socket-route-provider.js';

// Mock providers (for testing/development only)
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

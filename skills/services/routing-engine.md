# Routing Engine Skill

## Purpose
This skill defines the implementation guidelines for the Routing Engine - the component responsible for selecting the optimal path from customer assets to merchant settlement.

## Core Responsibilities

### 1. Route Aggregation
- Aggregate quotes from multiple bridge/DEX aggregators
- Support LI.FI, Socket, Across, Squid, 1inch
- Normalize quote formats across providers

### 2. Route Scoring
- Score candidate paths on multiple dimensions
- Select optimal route based on merchant preferences
- Provide transparent fee breakdown

### 3. Route Execution
- Execute selected routes through provider APIs
- Monitor execution status
- Handle execution failures and retries

## Data Model

### RouteQuote
```typescript
interface RouteQuote {
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

interface RouteStep {
  chain: string;
  protocol: string;
  action: string;
  input_amount: number;
  output_amount: number;
  fee: number;
}
```

### RouteScore
```typescript
interface RouteScore {
  total_score: number;
  fee_score: number;
  time_score: number;
  security_score: number;
  reliability_score: number;
}
```

### RouteExecutionResult
```typescript
interface RouteExecutionResult {
  execution_id: string;
  status: RouteStatus;
  transaction_hashes: string[];
  actual_fee: number;
  actual_time: number;
}

type RouteStatus = 
  | 'PENDING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED';
```

## Provider Interface

### IRouteProvider
```typescript
interface IRouteProvider {
  getName(): string;
  quote(params: RouteQuoteParams): Promise<RouteQuote>;
  execute(route: RouteQuote): Promise<RouteExecutionResult>;
  getStatus(executionId: string): Promise<RouteStatus>;
  getSupportedChains(): string[];
  getSupportedAssets(chain: string): string[];
}
```

### Provider Implementations
1. **LiFiProvider** - Multi-chain bridge aggregator
2. **SocketProvider** - Cross-chain aggregator
3. **AcrossProvider** - Fast bridge with UMA oracle
4. **SquidProvider** - Axelar-based bridge
5. **OneInchProvider** - DEX aggregator

## Scoring Algorithm

### Weighted Scoring
```typescript
function calculateScore(quote: RouteQuote, preferences: MerchantPreferences): RouteScore {
  const feeScore = normalizeFeeScore(quote.estimated_fee, preferences.max_fee);
  const timeScore = normalizeTimeScore(quote.estimated_time, preferences.max_time);
  const securityScore = quote.security_score;
  const reliabilityScore = quote.reliability_score;

  const totalScore = 
    feeScore * preferences.fee_weight +
    timeScore * preferences.time_weight +
    securityScore * preferences.security_weight +
    reliabilityScore * preferences.reliability_weight;

  return {
    total_score: totalScore,
    fee_score: feeScore,
    time_score: timeScore,
    security_score: securityScore,
    reliability_score: reliabilityScore
  };
}
```

### Normalization Functions
```typescript
function normalizeFeeScore(fee: number, maxFee: number): number {
  return Math.max(0, 1 - (fee / maxFee));
}

function normalizeTimeScore(time: number, maxTime: number): number {
  return Math.max(0, 1 - (time / maxTime));
}
```

### Security Scoring Factors
1. **Bridge TVL** - Higher TVL = higher score
2. **Audit Status** - Audited bridges score higher
3. **History** - No incidents = higher score
4. **Decentralization** - More decentralized = higher score

### Reliability Scoring Factors
1. **Uptime** - Historical uptime percentage
2. **Latency** - Average execution time
3. **Success Rate** - Historical success rate
4. **Provider Diversity** - Multiple providers = higher score

## Route Selection Logic

### Parallel Quote Fetching
```typescript
async function selectBestRoute(
  intent: PaymentIntent,
  providers: IRouteProvider[],
  preferences: MerchantPreferences
): Promise<RouteQuote> {
  // Fetch quotes from all providers in parallel
  const quotes = await Promise.allSettled(
    providers.map(provider => provider.quote({
      source_chain: intent.source_chain,
      source_asset: intent.source_asset,
      source_amount: intent.source_amount,
      target_chain: intent.target_chain,
      target_asset: intent.target_asset,
      target_amount: intent.target_amount
    }))
  );

  // Filter successful quotes
  const validQuotes = quotes
    .filter((result): result is PromiseFulfilledResult<RouteQuote> => 
      result.status === 'fulfilled' && 
      result.value.expires_at > new Date()
    )
    .map(result => result.value);

  if (validQuotes.length === 0) {
    throw new RoutingError('NO_VALID_QUOTES', 'No valid quotes available');
  }

  // Score and select best route
  const scoredQuotes = validQuotes.map(quote => ({
    quote,
    score: calculateScore(quote, preferences)
  }));

  scoredQuotes.sort((a, b) => b.score.total_score - a.score.total_score);

  return scoredQuotes[0].quote;
}
```

## Provider Abstraction

### Provider Registry
```typescript
class ProviderRegistry {
  private providers: Map<string, IRouteProvider> = new Map();

  register(provider: IRouteProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  get(name: string): IRouteProvider | undefined {
    return this.providers.get(name);
  }

  getAll(): IRouteProvider[] {
    return Array.from(this.providers.values());
  }

  getSupportedProviders(
    sourceChain: string,
    targetChain: string
  ): IRouteProvider[] {
    return this.getAll().filter(provider => 
      provider.getSupportedChains().includes(sourceChain) &&
      provider.getSupportedChains().includes(targetChain)
    );
  }
}
```

### Provider Adapter Pattern
```typescript
abstract class BaseRouteProvider implements IRouteProvider {
  abstract getName(): string;
  abstract getSupportedChains(): string[];
  abstract getSupportedAssets(chain: string): string[];

  async quote(params: RouteQuoteParams): Promise<RouteQuote> {
    // Common quote logic
    const rawQuote = await this.fetchRawQuote(params);
    return this.normalizeQuote(rawQuote);
  }

  async execute(route: RouteQuote): Promise<RouteExecutionResult> {
    // Common execution logic
    const rawResult = await this.executeRaw(route);
    return this.normalizeResult(rawResult);
  }

  protected abstract fetchRawQuote(params: RouteQuoteParams): Promise<any>;
  protected abstract normalizeQuote(raw: any): Promise<RouteQuote>;
  protected abstract executeRaw(route: RouteQuote): Promise<any>;
  protected abstract normalizeResult(raw: any): Promise<RouteExecutionResult>;
}
```

## Error Handling

### Error Types
```typescript
enum RoutingError {
  NO_VALID_QUOTES = 'NO_VALID_QUOTES',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  UNSUPPORTED_CHAIN = 'UNSUPPORTED_CHAIN',
  UNSUPPORTED_ASSET = 'UNSUPPORTED_ASSET'
}
```

### Circuit Breaker Pattern
```typescript
class CircuitBreaker {
  private failures: number = 0;
  private lastFailure: Date | null = null;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldRetry()) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();
    if (this.failures >= 5) {
      this.state = 'OPEN';
    }
  }

  private shouldRetry(): boolean {
    if (!this.lastFailure) return false;
    const timeSinceFailure = Date.now() - this.lastFailure.getTime();
    return timeSinceFailure > 30000; // 30 seconds
  }
}
```

## Performance Requirements

### Latency
- Quote aggregation: < 500ms
- Route selection: < 100ms
- Execution initiation: < 200ms

### Throughput
- 1,000+ quote requests per minute
- 100+ executions per minute

### Caching
- Cache quotes for 10 seconds
- Cache provider capabilities for 1 hour
- Cache security scores for 24 hours

## Security Considerations

### Quote Validation
- Verify quote signatures where available
- Check quote expiry before execution
- Validate amounts within acceptable slippage

### Execution Security
- Use secure key management for provider API keys
- Implement rate limiting per provider
- Monitor for suspicious activity

### Audit Trail
- Log all quote requests and responses
- Log all execution attempts and results
- Maintain decision logs for each route selection

## Monitoring and Observability

### Metrics
1. **Quote Latency** - Time to fetch quotes
2. **Quote Success Rate** - Percentage of successful quotes
3. **Execution Latency** - Time to execute routes
4. **Execution Success Rate** - Percentage of successful executions
5. **Provider Uptime** - Availability of each provider

### Alerting
1. **Provider Down** - Alert when provider is unavailable
2. **High Latency** - Alert when quote/execution time exceeds threshold
3. **Low Success Rate** - Alert when success rate drops below threshold
4. **Circuit Breaker Open** - Alert when circuit breaker trips

### Dashboards
1. **Provider Performance** - Comparison of provider metrics
2. **Route Distribution** - Which routes are being selected
3. **Fee Analysis** - Total fees and fee breakdown
4. **Error Analysis** - Common error patterns
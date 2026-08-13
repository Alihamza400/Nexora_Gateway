# Testing and Quality Assurance Skill

## Purpose
This skill defines the implementation guidelines for Testing and Quality Assurance - the practices and tools for ensuring code quality, reliability, and correctness.

## Core Responsibilities

### 1. Test Strategy
- Unit testing for individual components
- Integration testing for service interactions
- End-to-end testing for complete flows
- Performance testing for scalability

### 2. Test Automation
- Automated test execution in CI/CD
- Test coverage reporting
- Mutation testing for test quality

### 3. Quality Gates
- Code review requirements
- Static analysis
- Security scanning

## Test Pyramid

### Unit Tests (70%)
```typescript
// Example: Payment Intent Service unit test
describe('PaymentIntentService', () => {
  let service: PaymentIntentService;
  let mockRepository: MockPaymentIntentRepository;

  beforeEach(() => {
    mockRepository = new MockPaymentIntentRepository();
    service = new PaymentIntentService(mockRepository);
  });

  describe('createIntent', () => {
    it('should create intent with correct initial state', async () => {
      const intentData = {
        merchant_id: 'merchant-123',
        order_ref: 'order-456',
        target_amount: 100,
        target_asset: 'USDC',
        target_chain: '1',
        accepted_assets: ['USDC', 'USDT']
      };

      const intent = await service.createIntent(intentData);

      expect(intent.state).toBe('CREATED');
      expect(intent.merchant_id).toBe('merchant-123');
      expect(intent.target_amount).toBe(100);
    });

    it('should validate required fields', async () => {
      const intentData = {
        merchant_id: 'merchant-123',
        // Missing required fields
      };

      await expect(service.createIntent(intentData))
        .rejects.toThrow('Missing required fields');
    });
  });

  describe('transition', () => {
    it('should allow valid state transitions', async () => {
      const intent = await service.createIntent({
        merchant_id: 'merchant-123',
        order_ref: 'order-456',
        target_amount: 100,
        target_asset: 'USDC',
        target_chain: '1',
        accepted_assets: ['USDC']
      });

      const transitioned = await service.transition(intent.id, {
        type: 'QUOTE_GENERATED',
        payload: { rate: 1.0 },
        timestamp: new Date()
      });

      expect(transitioned.state).toBe('QUOTED');
    });

    it('should reject invalid state transitions', async () => {
      const intent = await service.createIntent({
        merchant_id: 'merchant-123',
        order_ref: 'order-456',
        target_amount: 100,
        target_asset: 'USDC',
        target_chain: '1',
        accepted_assets: ['USDC']
      });

      // Try to go from CREATED directly to SETTLED
      await expect(service.transition(intent.id, {
        type: 'SETTLEMENT_CONFIRMED',
        payload: {},
        timestamp: new Date()
      })).rejects.toThrow('Invalid state transition');
    });
  });
});
```

### Integration Tests (20%)
```typescript
// Example: Routing Engine integration test
describe('RoutingEngine Integration', () => {
  let engine: RoutingEngine;
  let mockProvider1: MockRouteProvider;
  let mockProvider2: MockRouteProvider;

  beforeEach(() => {
    mockProvider1 = new MockRouteProvider('provider1');
    mockProvider2 = new MockRouteProvider('provider2');
    engine = new RoutingEngine([mockProvider1, mockProvider2]);
  });

  describe('selectBestRoute', () => {
    it('should aggregate quotes from multiple providers', async () => {
      mockProvider1.quote.mockResolvedValue({
        id: 'quote-1',
        provider: 'provider1',
        estimated_fee: 10,
        estimated_time: 60
      });

      mockProvider2.quote.mockResolvedValue({
        id: 'quote-2',
        provider: 'provider2',
        estimated_fee: 5,
        estimated_time: 120
      });

      const route = await engine.selectBestRoute({
        source_chain: '1',
        target_chain: '137',
        source_asset: 'USDC',
        target_asset: 'USDC',
        amount: 1000
      });

      expect(route.id).toBe('quote-2'); // Lower fee selected
      expect(mockProvider1.quote).toHaveBeenCalled();
      expect(mockProvider2.quote).toHaveBeenCalled();
    });

    it('should handle provider failures gracefully', async () => {
      mockProvider1.quote.mockRejectedValue(new Error('Provider down'));
      mockProvider2.quote.mockResolvedValue({
        id: 'quote-2',
        provider: 'provider2',
        estimated_fee: 5,
        estimated_time: 120
      });

      const route = await engine.selectBestRoute({
        source_chain: '1',
        target_chain: '137',
        source_asset: 'USDC',
        target_asset: 'USDC',
        amount: 1000
      });

      expect(route.provider).toBe('provider2');
    });
  });
});
```

### End-to-End Tests (10%)
```typescript
// Example: Complete payment flow E2E test
describe('Payment Flow E2E', () => {
  let app: Application;
  let testMerchant: Merchant;
  let testCustomer: Customer;

  beforeAll(async () => {
    app = await createTestApp();
    testMerchant = await createTestMerchant();
    testCustomer = await createTestCustomer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Complete payment flow', () => {
    it('should process payment from creation to settlement', async () => {
      // 1. Create intent
      const intentResponse = await request(app)
        .post('/api/v1/intents')
        .send({
          merchant_id: testMerchant.id,
          order_ref: 'test-order-123',
          target_amount: 100,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: ['USDC', 'USDT']
        })
        .expect(201);

      const intent = intentResponse.body;
      expect(intent.state).toBe('CREATED');

      // 2. Get quote
      const quoteResponse = await request(app)
        .post(`/api/v1/intents/${intent.intent_id}/quote`)
        .send({
          source_asset: 'USDC',
          source_chain: '1'
        })
        .expect(200);

      const quote = quoteResponse.body;
      expect(quote.rate).toBeDefined();
      expect(quote.expires_at).toBeDefined();

      // 3. Simulate deposit (in real scenario, this would be on-chain)
      await request(app)
        .post(`/api/v1/intents/${intent.intent_id}/deposit`)
        .send({
          tx_hash: '0x...',
          amount: 100,
          asset: 'USDC',
          chain: '1'
        })
        .expect(200);

      // 4. Wait for confirmation and settlement
      await waitForSettlement(intent.intent_id);

      // 5. Verify final state
      const finalResponse = await request(app)
        .get(`/api/v1/intents/${intent.intent_id}`)
        .expect(200);

      expect(finalResponse.body.state).toBe('SETTLED');
    });
  });
});
```

## Test Data Management

### Test Factories
```typescript
// Test data factories
class TestFactories {
  static createPaymentIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
    return {
      id: crypto.randomUUID(),
      merchant_id: 'test-merchant',
      order_ref: `test-order-${Date.now()}`,
      target_amount: 100,
      target_asset: 'USDC',
      target_chain: '1',
      accepted_assets: ['USDC', 'USDT'],
      quoted_rate: 1.0,
      quote_expires_at: new Date(Date.now() + 5 * 60 * 1000),
      state: 'CREATED',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  static createRouteQuote(overrides: Partial<RouteQuote> = {}): RouteQuote {
    return {
      id: crypto.randomUUID(),
      provider: 'test-provider',
      source_chain: '1',
      source_asset: 'USDC',
      source_amount: 100,
      target_chain: '137',
      target_asset: 'USDC',
      target_amount: 99.9,
      steps: [],
      estimated_fee: 0.1,
      estimated_time: 60,
      security_score: 0.9,
      reliability_score: 0.95,
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      ...overrides
    };
  }

  static createRecoveryCase(overrides: Partial<RecoveryCase> = {}): RecoveryCase {
    return {
      id: crypto.randomUUID(),
      related_intent_id: null,
      case_type: 'MISDIRECTED',
      status: 'DETECTED',
      customer_address: '0x...',
      customer_chain: '1',
      intended_chain: '137',
      asset: 'USDC',
      amount: 100,
      tx_hash: '0x...',
      resolution_action: null,
      resolution_tx_hash: null,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      ...overrides
    };
  }
}
```

### Mock Services
```typescript
// Mock implementations
class MockPaymentIntentRepository implements IPaymentIntentRepository {
  private intents: Map<string, PaymentIntent> = new Map();

  async create(intent: NewPaymentIntent): Promise<PaymentIntent> {
    const newIntent: PaymentIntent = {
      id: crypto.randomUUID(),
      ...intent,
      state: 'CREATED',
      created_at: new Date(),
      updated_at: new Date()
    };
    this.intents.set(newIntent.id, newIntent);
    return newIntent;
  }

  async transition(id: string, event: IntentEvent): Promise<PaymentIntent> {
    const intent = this.intents.get(id);
    if (!intent) throw new Error('Intent not found');

    // Validate transition
    if (!this.isValidTransition(intent.state, event.type)) {
      throw new Error('Invalid state transition');
    }

    // Update state
    const newState = this.getNextState(intent.state, event.type);
    intent.state = newState;
    intent.updated_at = new Date();

    return intent;
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    return this.intents.get(id) || null;
  }

  private isValidTransition(current: string, event: string): boolean {
    const validTransitions: Record<string, string[]> = {
      CREATED: ['QUOTE_GENERATED'],
      QUOTED: ['DEPOSIT_DETECTED'],
      // ... more transitions
    };
    return validTransitions[current]?.includes(event) || false;
  }

  private getNextState(current: string, event: string): string {
    const transitions: Record<string, Record<string, string>> = {
      CREATED: { QUOTE_GENERATED: 'QUOTED' },
      QUOTED: { DEPOSIT_DETECTED: 'AWAITING_PAYMENT' },
      // ... more transitions
    };
    return transitions[current]?.[event] || current;
  }
}
```

## Code Coverage

### Coverage Configuration
```typescript
// jest.config.ts
export default {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/services/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ]
};
```

### Coverage Reports
```typescript
// Coverage report generator
class CoverageReporter {
  async generateReport(coverageData: any): Promise<CoverageReport> {
    const totalLines = coverageData.total.lines;
    const coveredLines = coverageData.total.coveredLines;
    
    return {
      timestamp: new Date(),
      summary: {
        totalLines,
        coveredLines,
        lineCoverage: (coveredLines / totalLines) * 100,
        totalFunctions: coverageData.total.functions,
        coveredFunctions: coverageData.total.coveredFunctions,
        functionCoverage: (coverageData.total.coveredFunctions / coverageData.total.functions) * 100
      },
      uncoveredFiles: this.getUncoveredFiles(coverageData),
      recommendations: this.generateRecommendations(coverageData)
    };
  }

  private getUncoveredFiles(coverageData: any): string[] {
    return Object.entries(coverageData.files)
      .filter(([_, data]: [string, any]) => data.lines.pct < 80)
      .map(([file]) => file);
  }

  private generateRecommendations(coverageData: any): string[] {
    const recommendations: string[] = [];
    
    if (coverageData.total.lines.pct < 80) {
      recommendations.push('Increase line coverage to 80%');
    }
    
    if (coverageData.total.branches.pct < 80) {
      recommendations.push('Increase branch coverage to 80%');
    }
    
    return recommendations;
  }
}

interface CoverageReport {
  timestamp: Date;
  summary: {
    totalLines: number;
    coveredLines: number;
    lineCoverage: number;
    totalFunctions: number;
    coveredFunctions: number;
    functionCoverage: number;
  };
  uncoveredFiles: string[];
  recommendations: string[];
}
```

## Mutation Testing

### Mutation Testing Configuration
```typescript
// stryker.config.ts
export default {
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ],
  testRunner: 'jest',
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: {
    high: 80,
    low: 60,
    break: null
  },
  plugins: ['@stryker-mutator/typescript-checker']
};
```

### Mutation Test Example
```typescript
// Original code
function calculateFee(amount: number, rate: number): number {
  return amount * rate;
}

// Mutations
// 1. Change * to +
function calculateFee(amount: number, rate: number): number {
  return amount + rate; // Mutation 1
}

// 2. Change * to -
function calculateFee(amount: number, rate: number): number {
  return amount - rate; // Mutation 2
}

// 3. Change * to /
function calculateFee(amount: number, rate: number): number {
  return amount / rate; // Mutation 3
}

// Test that kills mutations
describe('calculateFee', () => {
  it('should calculate fee correctly', () => {
    expect(calculateFee(100, 0.1)).toBe(10); // Kills mutation 1, 2, 3
  });
});
```

## Static Analysis

### ESLint Configuration
```javascript
// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript'
  ],
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    'import/order': ['error', {
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc' }
    }]
  }
};
```

### TypeScript Strict Mode
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## Security Testing

### SAST (Static Application Security Testing)
```yaml
# Snyk configuration
rules:
  - id: sql-injection
    pattern: |
      $QUERY = "...";
      $DB.execute($QUERY);
    message: "Potential SQL injection"
    severity: HIGH
    
  - id: xss-vulnerability
    pattern: |
      $RESPONSE.send($USER_INPUT);
    message: "Potential XSS vulnerability"
    severity: MEDIUM
```

### DAST (Dynamic Application Security Testing)
```yaml
# OWASP ZAP configuration
env:
  contexts:
    - name: crypto-gateway
      urls:
        - https://api.crypto-gateway.com
      includePaths:
        - https://api.crypto-gateway.com/api/.*
      excludePaths:
        - https://api.crypto-gateway.com/api/health
        
  policies:
    - name: full-scan
      rules:
        - id: 10021
          strength: HIGH
          threshold: LOW
```

### Dependency Scanning
```yaml
# Dependabot configuration
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "security"
```

## Performance Testing

### Load Testing with k6
```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // Less than 1% failure rate
  },
};

export default function () {
  const res = http.post('https://api.crypto-gateway.com/api/v1/intents', JSON.stringify({
    merchant_id: 'test-merchant',
    order_ref: `order-${Date.now()}`,
    target_amount: 100,
    target_asset: 'USDC',
    target_chain: '1',
    accepted_assets: ['USDC']
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 201': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

### Stress Testing
```javascript
// stress-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 500 },   // Spike to 500 users
    { duration: '3m', target: 500 },   // Stay at 500
    { duration: '1m', target: 1000 },  // Spike to 1000
    { duration: '3m', target: 1000 },  // Stay at 1000
    { duration: '1m', target: 0 },     // Ramp down
  ],
};

export default function () {
  const res = http.get('https://api.crypto-gateway.com/api/v1/health');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 1s': (r) => r.timings.duration < 1000,
  });
}
```

## Test Automation

### CI/CD Integration
```yaml
# GitHub Actions test workflow
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
          
      redis:
        image: redis:7
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run unit tests
      run: npm run test:unit -- --coverage
      
    - name: Run integration tests
      run: npm run test:integration
      env:
        DATABASE_URL: postgres://test:test@localhost:5432/test_db
        REDIS_URL: redis://localhost:6379
        
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
```

## Quality Gates

### Code Review Checklist
```markdown
# Code Review Checklist

## Functionality
- [ ] Code does what it's supposed to do
- [ ] Edge cases are handled
- [ ] Error handling is comprehensive

## Code Quality
- [ ] Code follows style guidelines
- [ ] No code duplication
- [ ] Functions are small and focused
- [ ] Variables and functions are well-named

## Testing
- [ ] Unit tests are provided
- [ ] Integration tests are provided (if applicable)
- [ ] Test coverage meets requirements

## Security
- [ ] No hardcoded secrets
- [ ] Input validation is present
- [ ] SQL injection prevention
- [ ] XSS prevention

## Performance
- [ ] No N+1 queries
- [ ] Appropriate indexing
- [ ] Caching where needed

## Documentation
- [ ] Code is documented
- [ ] API documentation is updated
- [ ] README is updated (if needed)
```

## Performance Requirements

### Test Execution
- Unit tests: < 5 minutes
- Integration tests: < 15 minutes
- E2E tests: < 30 minutes
- Full test suite: < 60 minutes

### Coverage Targets
- Line coverage: > 80%
- Branch coverage: > 80%
- Function coverage: > 80%

### Mutation Testing
- Mutation score: > 70%

### Performance Tests
- Load test duration: 15 minutes
- Stress test duration: 10 minutes
- Spike test duration: 5 minutes
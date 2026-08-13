# Crypto Gateway Skills

## Overview

This directory contains comprehensive skills for building a multi-chain crypto payment gateway. Each skill provides detailed implementation guidelines, code examples, and best practices for different aspects of the system.

## Skills Structure

```
skills/
├── architecture/
│   └── overview.md           # System architecture and design principles
├── services/
│   ├── payment-intent-service.md  # Payment intent lifecycle management
│   ├── routing-engine.md          # Route selection and optimization
│   ├── chain-abstraction.md       # Chain-specific logic abstraction
│   ├── settlement-reconciliation.md  # Merchant payout and accounting
│   └── recovery-service.md        # Failure mode handling
├── security/
│   └── compliance.md          # KYC/AML and sanctions screening
├── devops/
│   └── deployment.md          # Infrastructure and CI/CD
├── workflows/
│   ├── testing-qa.md          # Testing strategy and quality assurance
│   └── development.md         # Development workflow and collaboration
└── README.md                  # This file
```

## Quick Start

### 1. Architecture Overview
Start with `architecture/overview.md` to understand:
- Core design principles
- System components
- Module boundaries
- Interface contracts

### 2. Service Implementation
Implement services in this order:
1. `services/payment-intent-service.md` - Core payment lifecycle
2. `services/chain-abstraction.md` - Chain integration layer
3. `services/routing-engine.md` - Path selection
4. `services/settlement-reconciliation.md` - Merchant payouts
5. `services/recovery-service.md` - Failure handling

### 3. Security & Compliance
Implement security measures:
- `security/compliance.md` - KYC/AML screening

### 4. DevOps & Deployment
Set up infrastructure:
- `devops/deployment.md` - Kubernetes, CI/CD, monitoring

### 5. Quality Assurance
Establish quality practices:
- `workflows/testing-qa.md` - Testing strategy
- `workflows/development.md` - Development workflow

## Key Design Principles

### 1. Aggregate, Don't Rebuild
- Use existing bridge/DEX aggregators
- Leverage managed RPC providers
- Never build custom bridges

### 2. Intent-Based Architecture
- Every payment is an "intent"
- System decides optimal path
- Enables gas abstraction and recovery

### 3. Single Source of Truth
- One owner for each data type
- Repository pattern for persistence
- Event-driven state transitions

### 4. Interface Segregation
- Narrow, focused interfaces
- Dependency inversion
- Easy provider swapping

### 5. Fail-Fast, Not Fail-Silent
- Validate all inputs
- Reject invalid operations
- Log all errors

## Interface Contracts

### IRouteProvider
```typescript
interface IRouteProvider {
  getName(): string;
  quote(params: RouteQuoteParams): Promise<RouteQuote>;
  execute(route: RouteQuote): Promise<RouteExecutionResult>;
  getStatus(executionId: string): Promise<RouteStatus>;
}
```

### IChainClient
```typescript
interface IChainClient {
  chainId: string;
  getConfirmationDepth(): number;
  watchDeposits(address: string, onDeposit: (tx: DepositEvent) => void): Unsubscribe;
  estimateGas(tx: UnsignedTx): Promise<GasEstimate>;
  submitTransaction(tx: SignedTx): Promise<TxResult>;
  getTransactionStatus(txHash: string): Promise<TxStatus>;
}
```

### IRiskScorer
```typescript
interface IRiskScorer {
  screenAddress(address: string, chain: string): Promise<RiskResult>;
}
```

### IPaymentIntentRepository
```typescript
interface IPaymentIntentRepository {
  create(intent: NewPaymentIntent): Promise<PaymentIntent>;
  transition(id: string, event: IntentEvent): Promise<PaymentIntent>;
  findById(id: string): Promise<PaymentIntent | null>;
}
```

## State Machine

### Payment Intent States
```
CREATED → QUOTED → AWAITING_PAYMENT → DETECTED → CONFIRMING → ROUTING → SETTLING → SETTLED
```

### Side Branches
- `UNDERPAID` - Insufficient funds
- `OVERPAID` - Excess funds
- `MISDIRECTED` - Wrong chain/address
- `EXPIRED` - Quote TTL exceeded
- `REFUNDING` - Return funds
- `FAILED` - Terminal failure

## Module Boundaries

```
┌────────────────────────────────────────────────────────────┐
│                     API / Webhook Layer                     │
├────────────────────────────────────────────────────────────┤
│  Payment Intent   │  Routing    │  Risk & Rate  │ Settlement │
│  Service          │  Engine     │  Lock Engine  │  Service   │
├────────────────────────────────────────────────────────────┤
│              Chain Abstraction Layer (DRY boundary)          │
├────────────────────────────────────────────────────────────┤
│  Recovery  │ Reconciliation │ Compliance  │ Merchant Config  │
├────────────────────────────────────────────────────────────┤
│               Persistence (Postgres, append-only ledger)     │
└────────────────────────────────────────────────────────────┘
```

## Anti-Patterns to Avoid

### 1. God Service
- One component with multiple responsibilities
- Split before shipping

### 2. Shadow State
- Multiple places tracking same data
- Always leads to desync

### 3. Copy-Paste Chain Support
- Duplicating chain adapters
- Implement interfaces instead

### 4. Silent Catch Blocks
- Swallowing errors
- Violates fail-fast principle

### 5. Config Drift
- Hard-coded values
- Use SSOT config service

## Testing Strategy

### Test Pyramid
- **Unit Tests (70%)**: Individual components
- **Integration Tests (20%)**: Service interactions
- **E2E Tests (10%)**: Complete flows

### Coverage Targets
- Line coverage: > 80%
- Branch coverage: > 80%
- Function coverage: > 80%

## Performance Requirements

### Latency
- Intent creation: < 100ms
- Quote aggregation: < 500ms
- Settlement execution: < 5s

### Throughput
- 10,000+ intents per minute
- 1,000+ quotes per minute
- 100+ settlements per minute

### Availability
- 99.99% uptime
- Graceful degradation
- Automatic failover

## Security Considerations

### Key Management
- HSM for hot wallet keys
- Regular key rotation
- Access controls

### Transaction Security
- Input validation
- Rate limiting
- Monitoring

### Compliance
- KYC/AML screening
- Sanctions checks
- Audit trails

## Deployment

### Infrastructure
- Kubernetes clusters
- Multi-region deployment
- Auto-scaling

### CI/CD
- Automated testing
- Blue-green deployments
- Rollback capability

### Monitoring
- Application metrics
- Infrastructure metrics
- Alerting

## Contributing

### Code Review
- Follow checklist
- Provide constructive feedback
- Approve when ready

### Documentation
- Update relevant skills
- Add examples
- Keep README current

### Testing
- Write tests for new features
- Maintain coverage
- Run full suite before merge

## Support

For questions or issues:
1. Check the relevant skill file
2. Review architecture documentation
3. Consult team members
4. Create an issue if needed

## License

This project is proprietary. All rights reserved.
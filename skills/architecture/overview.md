# Crypto Gateway Architecture Overview Skill

## Purpose
This skill provides the foundational architecture knowledge for building a multi-chain crypto payment gateway that is optimized, secure, structured, scalable, and production-ready.

## Core Design Principles

### 1. Aggregate, Don't Rebuild
- Use existing bridge/DEX aggregators (LI.FI, Socket, Across, Squid)
- Leverage managed RPC providers (Alchemy, QuickNode)
- Never build custom bridges or consensus layers

### 2. Intent-Based Architecture
- Every payment is an "intent" not a transaction
- Customer expresses intent → System decides optimal path
- Enables gas abstraction, recovery, and rate-locking

### 3. Merchant Isolation
- Merchants configure settlement asset/chain once
- No exposure to volatility or chain complexity
- Universal settlement regardless of payment method

### 4. Recovery-First Design
- Wrong-chain sends are first-class states
- Underpayment, overpayment, stuck transactions have automated resolution
- No support tickets for recoverable scenarios

### 5. Pluggable Compliance
- KYC/AML/sanctions screening at intent creation and payout
- Core routing logic stays jurisdiction-agnostic
- Configurable per merchant and jurisdiction

## System Components

### Core Services
1. **Payment Intent Service** - System of record for payment attempts
2. **Routing Engine** - Path selection and optimization
3. **Gas Abstraction Layer** - Removes native token requirements
4. **Rate Lock / Risk Engine** - Volatility protection and risk scoring
5. **Deposit Address Layer** - Smart wallets per intent
6. **Chain Watchers** - Per-chain deposit detection
7. **Settlement Service** - Merchant payout execution
8. **Recovery Service** - Failure mode handling
9. **Reconciliation & Ledger** - Double-entry accounting
10. **Compliance Layer** - KYC/AML screening

### Data Flow
```
Customer → Intent Creation → Routing → Deposit Detection → Confirmation → Settlement → Merchant
         ↑                    ↑          ↑                  ↑              ↑
         └─ Rate Lock ────────┴──────────┴──────────────────┴──────────────┘
```

## Module Boundaries (SRP Applied)

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
- `UNDERPAID` - Insufficient funds received
- `OVERPAID` - Excess funds received
- `MISDIRECTED` - Payment to wrong address/chain
- `EXPIRED` - Quote TTL exceeded
- `REFUNDING` - Return funds to customer
- `FAILED` - Terminal failure state

## Anti-Patterns to Avoid

### 1. God Service
- Any component accumulating unrelated responsibilities
- Split before shipping, not after

### 2. Shadow State
- Second place tracking same data
- Always leads to desync bugs

### 3. Copy-Paste Chain Support
- Duplicating chain adapters instead of implementing interfaces
- Exact DRY failure mode this architecture prevents

### 4. Silent Catch Blocks
- Swallowing errors and proceeding
- Violates fail-fast principle

### 5. Config Drift
- Hard-coded values instead of SSOT config
- Environment-specific values must come from config service

## Success Criteria

### Optimization
- Route selection considers: total fee, confirmation time, bridge security
- Gas estimation feeds into rate-lock quotes
- No surprise deductions

### Security
- Treasury buffer uses MPC/multi-sig
- Deposit contracts audited before mainnet
- Settlement fires after chain-appropriate confirmation depth

### Structure
- Clean module boundaries with SRP
- Interface contracts for all major components
- Repository pattern for all persistence

### Scalability
- Modular monolith with clean internal interfaces
- Split into separate deployables only when needed
- Chain watchers isolated per chain

### Production Ready
- Idempotency by design
- Twelve-Factor config
- Fail-fast, not fail-silent
- Comprehensive error taxonomy
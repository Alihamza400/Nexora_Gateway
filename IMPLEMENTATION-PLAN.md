# Crypto Gateway — Implementation Plan

> **Build Order Reference:** `crypto-gateway-architecture.md` §8  
> **Skills Reference:** `skills/` directory  
> **Design Principles:** `skills/architecture/overview.md`

---

## Overview

This plan follows the architecture's recommended build order with 15 phases. Each phase produces a testable, shippable increment. The guiding principle: **prove each layer works before building the next one on top.**

```
Phase 0 → 1a → 1b → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
Scaffold   DB   Intent  Chain  Rate  Settle  Route  Gas   Multi  Recovery  Comp  Recon  DevOps  Tests  Audit  Launch
```

---

## Phase 0: Project Scaffolding

**Goal:** Working monorepo with tooling, linting, type checking, and local dev environment.

**Deliverables:**
- [ ] Initialize Node.js/TypeScript monorepo (npm workspaces or Turborepo)
- [ ] Configure `tsconfig.json` with strict mode, path aliases
- [ ] Set up ESLint + Prettier with shared configs
- [ ] Configure Husky pre-commit hooks (lint, typecheck, test)
- [ ] Docker Compose with PostgreSQL 14 + Redis 7
- [ ] Base project structure per `skills/workflows/development.md`:

```
crypto-gateway/
├── packages/
│   ├── shared/              # Shared types, errors, utils
│   ├── db/                  # Migrations, seed data
│   ├── chain-abstraction/   # Chain client library
│   ├── payment-intent/      # Intent service
│   ├── routing-engine/      # Routing service
│   ├── settlement/          # Settlement + ledger
│   ├── recovery/            # Recovery service
│   ├── compliance/          # KYC/AML screening
│   └── api-gateway/         # REST API layer
├── docker/
│   └── docker-compose.yml
├── config/
│   ├── development.yaml
│   ├── staging.yaml
│   └── production.yaml
├── .github/workflows/
├── package.json
├── tsconfig.base.json
└── README.md
```

**Tech Stack (per §6 of architecture):**

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 18+ with TypeScript 5.x |
| HTTP | Fastify (REST + webhooks) |
| DB | PostgreSQL 14 (append-only ledger) |
| Cache | Redis 7 (quote caching, rate limiting) |
| Testing | Vitest (unit), Supertest (integration) |
| Containers | Docker + Docker Compose |

**Skill Reference:** `skills/workflows/development.md`, `skills/devops/deployment.md`

---

## Phase 1a: Core Database Schema

**Goal:** Database schema supporting the full payment intent lifecycle.

**Deliverables:**
- [ ] PostgreSQL migrations for core tables
- [ ] Seed data for development

**Schema:**

```sql
-- Payment Intent (system of record)
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id VARCHAR(255) NOT NULL,
  order_ref VARCHAR(255) NOT NULL,
  target_amount DECIMAL(20, 8) NOT NULL,
  target_asset VARCHAR(20) NOT NULL,
  target_chain VARCHAR(20) NOT NULL,
  accepted_assets TEXT[] NOT NULL,
  quoted_rate DECIMAL(20, 8),
  quote_expires_at TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Intent Events (append-only audit trail)
CREATE TABLE intent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES payment_intents(id),
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Double-entry ledger
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  debit_account VARCHAR(255) NOT NULL,
  credit_account VARCHAR(255) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Merchant configuration
CREATE TABLE merchants (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  settlement_asset VARCHAR(20) NOT NULL,
  settlement_chain VARCHAR(20) NOT NULL,
  settlement_address VARCHAR(255) NOT NULL,
  accepted_chains TEXT[] NOT NULL,
  accepted_assets TEXT[] NOT NULL,
  fee_percentage DECIMAL(5, 2) DEFAULT 0,
  kyc_threshold DECIMAL(20, 8) DEFAULT 10000,
  quote_ttl_seconds INTEGER DEFAULT 300,
  webhook_url VARCHAR(500),
  api_key_hash VARCHAR(255) NOT NULL,
  compliance_status VARCHAR(20) DEFAULT 'COMPLIANT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recovery cases
CREATE TABLE recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_intent_id UUID REFERENCES payment_intents(id),
  case_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DETECTED',
  customer_address VARCHAR(255) NOT NULL,
  customer_chain VARCHAR(20) NOT NULL,
  intended_chain VARCHAR(20) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  tx_hash VARCHAR(255),
  resolution_action VARCHAR(30),
  resolution_tx_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Settlement records
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES payment_intents(id),
  merchant_id VARCHAR(255) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  asset VARCHAR(20) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  destination_address VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  tx_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_intents_merchant ON payment_intents(merchant_id);
CREATE INDEX idx_intents_state ON payment_intents(state);
CREATE INDEX idx_intents_order_ref ON payment_intents(order_ref);
CREATE INDEX idx_events_intent ON intent_events(intent_id);
CREATE INDEX idx_ledger_intent ON ledger_entries(intent_id);
CREATE INDEX idx_ledger_account ON ledger_entries(debit_account, credit_account);
CREATE INDEX idx_settlements_intent ON settlements(intent_id);
CREATE INDEX idx_recovery_status ON recovery_cases(status);
```

**Skill Reference:** `skills/services/payment-intent-service.md` (Data Model), `skills/services/settlement-reconciliation.md` (Data Model)

---

## Phase 1b: Payment Intent Service

**Goal:** Core state machine and API — the spine the entire system hangs off.

**Deliverables:**
- [ ] `PaymentIntentService` with full state machine (`skills/services/payment-intent-service.md`)
- [ ] `PaymentIntentRepository` (single writer principle, optimistic locking)
- [ ] REST API: `POST /api/v1/intents`, `GET /api/v1/intents/:id`
- [ ] Webhook delivery system with retry logic
- [ ] Merchant authentication (API key → merchant lookup)
- [ ] Unit tests for state transitions, quote generation, webhook signing

**State Machine:**
```
CREATED → QUOTED → AWAITING_PAYMENT → DETECTED → CONFIRMING → ROUTING → SETTLING → SETTLED
```

**Key Interfaces:**
```typescript
interface IPaymentIntentRepository {
  create(intent: NewPaymentIntent): Promise<PaymentIntent>;
  transition(id: string, event: IntentEvent): Promise<PaymentIntent>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByMerchantId(merchantId: string): Promise<PaymentIntent[]>;
  findExpiredIntents(): Promise<PaymentIntent[]>;
}
```

**Validation Rules:**
- Only valid state transitions allowed (per VALID_TRANSITIONS map)
- Optimistic locking via version field prevents concurrent modifications
- Every transition emits an event to `intent_events` table

**Skill Reference:** `skills/services/payment-intent-service.md`

---

## Phase 2: Chain Abstraction Layer

**Goal:** Unified interface for all chain interactions — the DRY boundary.

**Deliverables:**
- [ ] `IChainClient` interface (`skills/services/chain-abstraction.md`)
- [ ] `EVMChainClient` implementation (Ethereum + Base)
- [ ] `ChainRegistry` for chain lookup
- [ ] Deposit watchers (block polling → event emission)
- [ ] Gas estimation with EIP-1559 support
- [ ] Unit tests for address validation, gas estimation, tx status

**Key Interfaces:**
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

**Chain Config (v1):**

| Chain | Confirmation Depth | Block Time | Native Asset |
|-------|-------------------|------------|--------------|
| Ethereum (1) | 12 | 12s | ETH |
| Base (8453) | 1 | 2s | ETH |
| Arbitrum (42161) | 1 | 0.25s | ETH |
| Polygon (137) | 128 | 2s | MATIC |
| Tron | 19 | 3s | TRX |
| Solana | 32 | 0.4s | SOL |

**Skill Reference:** `skills/services/chain-abstraction.md`

---

## Phase 3: Rate Lock & Risk Engine

**Goal:** Remove volatility exposure for merchants.

**Deliverables:**
- [ ] `RateLockService` with configurable TTL
- [ ] Price oracle integration (CoinGecko / Chainlink)
- [ ] Treasury buffer module (market-maker integration stub)
- [ ] Basic `IRiskScorer` interface + stub implementation
- [ ] Risk scoring: wallet age, transaction count, basic sanctions check

**Rate Lock Flow:**
1. On intent creation, fetch current rate from oracle
2. Lock rate with TTL (default 2-5 min, configurable per merchant)
3. Store locked rate in intent record
4. Settlement uses locked rate, not live market rate
5. Treasury absorbs (or profits from) spread between locked and actual rate

**Risk Scoring Factors:**
- Sanctions list match → CRITICAL (block)
- Mixer/darknet association → HIGH
- New address (< 30 days) → MEDIUM
- High velocity → MEDIUM
- Clean history → LOW

**Skill Reference:** `skills/security/compliance.md`, `skills/architecture/overview.md` §3.4

---

## Phase 4: Basic Settlement & Ledger

**Goal:** Single-chain happy-path settlement with double-entry accounting.

**Deliverables:**
- [ ] `SettlementService` (`skills/services/settlement-reconciliation.md`)
- [ ] `LedgerService` (double-entry, append-only)
- [ ] Settlement execution: sign → submit → confirm → record
- [ ] Ledger entries: DEPOSIT, FEE, SETTLEMENT
- [ ] Reconciliation service (basic: match ledger vs on-chain)
- [ ] Unit tests for settlement amount calculation, ledger consistency

**Settlement Flow:**
```
Intent SETTLED
  → Calculate amount (target_amount - fees)
  → Create settlement record (PENDING)
  → Get hot wallet address for chain
  → Sign transaction
  → Submit to chain
  → Wait for confirmation depth
  → Update settlement (COMPLETED)
  → Record ledger entry (SETTLEMENT)
```

**Skill Reference:** `skills/services/settlement-reconciliation.md`

---

## Phase 5: Routing Engine

**Goal:** Multi-provider route aggregation and selection.

**Deliverables:**
- [ ] `IRouteProvider` interface (`skills/services/routing-engine.md`)
- [ ] `BaseRouteProvider` abstract class (adapter pattern)
- [ ] `LiFiProvider` adapter
- [ ] `SocketProvider` adapter
- [ ] `ProviderRegistry` with circuit breaker pattern
- [ ] Route scoring algorithm (weighted: fee, time, security, reliability)
- [ ] Parallel quote fetching with timeout
- [ ] Unit tests for scoring, provider fallback, circuit breaker

**Scoring Algorithm:**
```typescript
totalScore = 
  feeScore * preferences.fee_weight +
  timeScore * preferences.time_weight +
  securityScore * preferences.security_weight +
  reliabilityScore * preferences.reliability_weight;
```

**Circuit Breaker:**
- 5 failures → OPEN (30s timeout)
- HALF_OPEN → retry one request
- Success → CLOSED

**Skill Reference:** `skills/services/routing-engine.md`

---

## Phase 6: Gas Abstraction

**Goal:** Customers never need to hold native gas tokens.

**Deliverables:**
- [ ] `GasAbstractionLayer` (`skills/services/chain-abstraction.md`)
- [ ] ERC-4337 paymaster integration (Alchemy/Biconomy/Pimlico)
- [ ] Relayer/meta-transaction pattern for non-AA chains
- [ ] Gas cost estimation feeds into rate-lock quotes
- [ ] Integration tests with testnet paymaster

**Strategy by Chain:**

| Chain Type | Approach |
|-----------|----------|
| EVM with AA (ETH, Base, Arb, Polygon) | ERC-4337 paymaster |
| EVM without AA | Relayer pattern |
| Tron | Resource model (energy/bandwidth) |
| Solana | Priority fee relay |

**Skill Reference:** `skills/services/chain-abstraction.md` (Gas Abstraction Integration)

---

## Phase 7: Multi-Chain Expansion

**Goal:** Tron + Solana support, cross-chain routing.

**Deliverables:**
- [ ] `TronChainClient` implementation
- [ ] `SolanaChainClient` implementation
- [ ] Cross-chain route selection (ETH → Polygon, Tron → ETH, etc.)
- [ ] Multi-chain deposit monitoring
- [ ] Integration tests for cross-chain flows

**Chain-Specific Considerations:**

| Chain | Finality | Gas Model | Watch Method |
|-------|----------|-----------|--------------|
| Tron | 19 blocks | Energy/Bandwidth | Event polling |
| Solana | 32 slots | Compute units | WebSocket logs |

**Skill Reference:** `skills/services/chain-abstraction.md`

---

## Phase 8: Recovery Service

**Goal:** Failure modes are first-class states, not support tickets.

**Deliverables:**
- [ ] `RecoveryService` (`skills/services/recovery-service.md`)
- [ ] Misdirected payment detection (wrong chain/address)
- [ ] Ownership verification (signed message)
- [ ] Underpayment: top-up link generation
- [ ] Overpayment: auto-refund or merchant credit
- [ ] Stuck transactions: RBF/relayer acceleration
- [ ] Integration tests for each recovery scenario

**Recovery Flows:**

```
MISDIRECTED:
  Detect → Verify ownership → Compliance check → Auto-credit (same value) OR Auto-refund

UNDERPAID:
  Detect shortfall → Generate top-up link → Notify customer → Wait for top-up → Complete

OVERPAID:
  Detect excess → Auto-refund excess OR Credit to merchant account

STUCK:
  Detect pending > 30min → RBF (Bitcoin) OR Relayer acceleration (EVM)
```

**Skill Reference:** `skills/services/recovery-service.md`

---

## Phase 9: Compliance Layer

**Goal:** Pluggable KYC/AML/sanctions screening.

**Deliverables:**
- [ ] `ComplianceLayer` (`skills/security/compliance.md`)
- [ ] `ChainalysisRiskScorer` adapter
- [ ] `TRMLabsRiskScorer` adapter
- [ ] Sanctions screening at intent creation AND settlement
- [ ] KYC threshold configuration per merchant
- [ ] Transaction monitoring with velocity checks
- [ ] Alert service for suspicious activity
- [ ] Audit log for all compliance decisions

**Screening Points:**
1. **Intent Creation:** Screen source address
2. **Deposit Detection:** Screen incoming transaction
3. **Settlement:** Screen destination address
4. **Periodic:** Re-screen addresses with new activity

**Skill Reference:** `skills/security/compliance.md`

---

## Phase 10: Reconciliation & Reporting

**Goal:** Financial accuracy and audit readiness.

**Deliverables:**
- [ ] `ReconciliationService` (`skills/services/settlement-reconciliation.md`)
- [ ] Period reconciliation (hourly/daily)
- [ ] Discrepancy detection (amount mismatch, missing settlement)
- [ ] Financial reports (settled, pending, failed)
- [ ] FX gain/loss tracking
- [ ] Export to CSV/JSON
- [ ] ERP integration stubs (QuickBooks, Xero, NetSuite)

**Reconciliation Checks:**
1. Ledger entry exists for every settled intent
2. Settlement amount matches rate-locked amount
3. No duplicate settlements
4. On-chain transactions match ledger entries
5. FX gain/loss calculated correctly

**Skill Reference:** `skills/services/settlement-reconciliation.md`

---

## Phase 11: DevOps & Infrastructure

**Goal:** Production-ready deployment infrastructure.

**Deliverables:**
- [ ] Kubernetes manifests (per-service deployments, HPAs, network policies)
- [ ] CI/CD pipeline (GitHub Actions): lint → typecheck → test → build → deploy
- [ ] Blue-green deployment strategy
- [ ] Prometheus + Grafana dashboards
- [ ] Alert rules (error rate, latency, settlement failures)
- [ ] Secrets management (HashiCorp Vault or Kubernetes secrets)
- [ ] Database backup CronJob (daily)
- [ ] Disaster recovery runbook

**Monitoring Dashboards:**
1. Payment Intent throughput (created vs settled)
2. Settlement success rate
3. Recovery case volume
4. Provider uptime and latency
5. Gas costs and optimization

**Skill Reference:** `skills/devops/deployment.md`

---

## Phase 12: Testing & QA

**Goal:** >80% test coverage, comprehensive quality gates.

**Deliverables:**
- [ ] Unit tests for all services (>80% line coverage)
- [ ] Integration tests for service interactions
- [ ] E2E tests for complete payment flow
- [ ] Load tests (10K+ intents/min target)
- [ ] Security scanning (Trivy in CI/CD)
- [ ] Mutation testing for test quality

**Test Distribution:**
- Unit: 70%
- Integration: 20%
- E2E: 10%

**Quality Gates:**
- All tests pass
- No critical/high security vulnerabilities
- Code review approved
- Type check passes
- Lint passes

**Skill Reference:** `skills/workflows/testing-qa.md`

---

## Phase 13: Smart Contract Audit Prep

**Goal:** Security hardening before mainnet.

**Deliverables:**
- [ ] Deposit address smart contracts (minimal, auditable)
- [ ] MPC/multi-sig treasury setup
- [ ] Security audit preparation (documentation, test vectors)
- [ ] Bug bounty program setup
- [ ] Incident response plan

**Contract Scope (minimal for v1):**
- Deposit address contract (accept multi-asset, forward to hot wallet)
- Allow-list enforcement (reject wrong assets at contract level)
- Emergency pause functionality

**Skill Reference:** `skills/architecture/overview.md` §7, `skills/security/compliance.md`

---

## Phase 14: Production Launch

**Goal:** Mainnet deployment with operational readiness.

**Deliverables:**
- [ ] Staging environment validation (full flow test)
- [ ] Mainnet deployment (Base first, then expand)
- [ ] Monitoring dashboards live
- [ ] Runbooks for common scenarios
- [ ] On-call rotation setup
- [ ] Merchant onboarding documentation
- [ ] API documentation (OpenAPI/Swagger)

**Launch Checklist:**
- [ ] All tests passing on staging
- [ ] Load test results acceptable
- [ ] Security audit complete
- [ ] Monitoring and alerting verified
- [ ] Runbooks reviewed
- [ ] On-call team trained
- [ ] Rollback procedure tested
- [ ] Merchant API keys provisioned

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0: Scaffolding | 2-3 days | None |
| Phase 1a: Database Schema | 2-3 days | Phase 0 |
| Phase 1b: Payment Intent Service | 5-7 days | Phase 1a |
| Phase 2: Chain Abstraction | 5-7 days | Phase 0 |
| Phase 3: Rate Lock & Risk | 3-5 days | Phase 1b |
| Phase 4: Settlement & Ledger | 5-7 days | Phase 1b, Phase 2 |
| Phase 5: Routing Engine | 5-7 days | Phase 2 |
| Phase 6: Gas Abstraction | 3-5 days | Phase 2 |
| Phase 7: Multi-Chain | 5-7 days | Phase 2 |
| Phase 8: Recovery Service | 5-7 days | Phase 1b, Phase 2 |
| Phase 9: Compliance | 3-5 days | Phase 1b |
| Phase 10: Reconciliation | 3-5 days | Phase 4 |
| Phase 11: DevOps | 5-7 days | Phase 0 |
| Phase 12: Testing & QA | 5-7 days | All phases |
| Phase 13: Audit Prep | 5-10 days | Phase 2 |
| Phase 14: Production Launch | 3-5 days | All phases |

**Estimated Total: 12-16 weeks** (with parallel work streams)

**Critical Path:** Phase 0 → 1a → 1b → 4 → 10 → 14

---

## Parallel Work Streams

These can be built concurrently:

```
Stream A (Core Flow):     0 → 1a → 1b → 3 → 4 → 10 → 14
Stream B (Chain Layer):   0 → 2 → 5 → 6 → 7
Stream C (Recovery):      0 → 1a → 1b → 8
Stream D (Compliance):    0 → 1a → 1b → 9
Stream E (DevOps):        0 → 11 (parallel with all)
Stream F (Contracts):     0 → 13 (parallel with all)
```

---

## Success Criteria

### Per Phase
- All unit tests pass
- All integration tests pass
- Code review approved
- Documentation updated

### Overall
- **Optimization:** Route selection considers total fee, confirmation time, bridge security
- **Security:** Treasury uses MPC/multi-sig, contracts audited, settlement after confirmation depth
- **Structure:** Clean module boundaries with SRP, interface contracts for all major components
- **Scalability:** Modular monolith, 10K+ intents/min, chain watchers isolated per chain
- **Production Ready:** Idempotent by design, Twelve-Factor config, fail-fast, comprehensive error taxonomy

---

## Next Steps

1. **Start Phase 0** — Initialize the project scaffold
2. **Review this plan** — Adjust timelines/priorities based on team size
3. **Set up CI/CD** — Even basic lint+test on push from day 1
4. **Begin parallel streams** — Chain abstraction and payment intent can start simultaneously

---

*This plan follows the skills in `skills/` directory and the architecture in `crypto-gateway-architecture.md`.*

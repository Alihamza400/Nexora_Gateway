# Product Technical Document — Engineering Principles & Design Rules

## Multi-Chain Crypto Payment Gateway

This document sits between the **PRD** (what/why) and the **Technical Architecture Document** (component map). It defines *how the codebase itself is disciplined* — the engineering rules every module, interface, and PR is expected to follow, and exactly where each principle applies in this specific system rather than as generic advice.

---

## 1. Why This Document Exists

Architecture diagrams describe components. They don't stop an engineer from copy-pasting the Tron settlement logic into the Solana settlement path, or from a single "God service" quietly absorbing routing, risk, and reconciliation because it was easier that week. This document is the guardrail layer: a shared, referenceable definition of *disciplined* for this codebase, so PR review has a standard to point to instead of a matter of individual taste.

---

## 2. Core Principles & How They Apply Here

### 2.1 SSOT — Single Source of Truth

Every piece of state in this system has exactly **one** authoritative owner. Nothing else is allowed to hold a competing copy of the truth — only read-through caches or derived projections of it.

| Data | Single Source of Truth | Everything else is... |
|---|---|---|
| Payment Intent state | **Payment Intent Service** (Postgres `intents` table) | ...a cached read, never a second writer |
| On-chain deposit facts (confirmed/reorged) | **Chain Watcher** per chain | Routing/Settlement read events, never re-derive confirmation status independently |
| Exchange rate for a given intent | **Rate Lock record**, written once at quote time | UI, webhooks, and settlement all reference the same locked-rate row, never re-fetch a live price mid-flow |
| Ledger balance | **Ledger Service** (append-only double-entry table) | Dashboards and merchant balance views are projections, never separately maintained counters |
| Merchant configuration (settlement asset, webhooks, accepted assets) | **Merchant Config Service** | Routing Engine and Settlement Service read this at execution time — never cache it long enough to go stale across a config change |

**Concrete rule:** if you find yourself writing a second `if` branch somewhere that re-derives something already computed and stored elsewhere (e.g., re-checking confirmation depth outside the Chain Watcher), that's an SSOT violation — pull the fact from its owner instead of recomputing it.

### 2.2 KISS — Keep It Simple

Applied as **default-to-boring** at every architectural fork in this specific system:

- **Don't build a custom bridge.** Route through existing bridge/DEX aggregators (LI.FI, Socket, Across). A custom bridge is the single most complex thing this team could build and the least differentiated.
- **Don't build a custom consensus/indexing layer.** Use managed RPC/webhook providers (Alchemy, QuickNode) with a thin abstraction on top, not a self-hosted indexing stack, until volume actually demands it.
- **Don't reach for microservices prematurely.** Start as a modular monolith with clean internal interfaces (see §4). Split into separate deployables only when a specific component (e.g., Chain Watchers, which are genuinely independent per-chain processes) needs independent scaling or failure isolation — not by default.
- **One state machine, not several implicit ones.** The Payment Intent lifecycle (§3 of the Architecture Doc) is the *only* place transaction state is modeled. No component should invent its own parallel status enum.

### 2.3 SOLID

Applied at the service/module boundary level, not just individual classes:

- **S — Single Responsibility.** Each core component in the Architecture Doc (Routing Engine, Risk Engine, Recovery Service, Reconciliation Service, etc.) owns exactly one reason to change. If a PR touches "how we score a route" and "how we screen a wallet" in the same module, that module has already violated SRP — these are two different concerns (routing quality vs. compliance) with two different owners and two different change cadences.
- **O — Open/Closed.** Adding a new chain or a new bridge provider should never require editing the Routing Engine's core decision logic — only adding a new adapter that implements the existing `IRouteProvider` interface (§4.1). If onboarding a chain means touching core logic, the abstraction is wrong.
- **L — Liskov Substitution.** Any `IChainClient` implementation (EVM, Tron, Solana) must be interchangeable from the caller's perspective — same contract, same error semantics. A Solana adapter that throws a raw RPC exception instead of the shared `ChainClientError` breaks every caller that only knows how to handle the shared error type.
- **I — Interface Segregation.** `IRoutingProvider` should not force implementers to also implement settlement or gas-sponsorship methods. Keep interfaces narrow — a bridge aggregator adapter only needs to quote and execute a route, nothing else.
- **D — Dependency Inversion.** The Routing Engine depends on the `IRouteProvider` interface, never on a concrete `LiFiClient` or `SocketClient` class. This is what makes "swap LI.FI for Socket if pricing changes" a config change instead of a rewrite — see §4.1 for the actual interface.

### 2.4 DRY — Don't Repeat Yourself

The biggest DRY risk in a multi-chain system is **duplicating chain-specific logic across every service that touches a chain** (Chain Watcher, Settlement, Recovery, Gas Abstraction all need to talk to Ethereum, Tron, Solana, etc.). The fix is a single **Chain Abstraction Layer** (§4.2) that every other component depends on — chain-specific quirks (confirmation depth, address format, fee estimation) are implemented exactly once per chain, in one place.

Other DRY boundaries in this system:
- **One quote/rate-lock calculation path**, used identically whether the quote is shown at checkout or re-validated at settlement.
- **One webhook delivery/retry mechanism**, reused by every service that needs to notify a merchant (intent state changes, recovery case updates, settlement confirmations) rather than each component rolling its own retry/backoff.
- **One error taxonomy** (`ChainClientError`, `RoutingError`, `ComplianceBlockError`, etc.) shared across all services, not per-service ad hoc error types.

### 2.5 YAGNI — You Aren't Gonna Need It

Explicitly **not building** in v1, even though they're architecturally "nice to have" (these map to the PRD's Out-of-Scope §5.2, restated here as engineering discipline):

- No custom bridge or liquidity network — use aggregators until there's a proven reason not to.
- No support for arbitrary/self-service chain onboarding by merchants — chains are added by the team via config, not exposed as a merchant-facing feature, until there's real demand.
- No multi-region active-active database from day one — start with a single-region Postgres with read replicas; multi-region is a scaling problem to solve when there's traffic that justifies it, not before.
- No generic plugin/rule-engine for risk scoring — hard-code the initial risk rules; abstract them into a rules engine only once there are enough real rules to justify the abstraction cost.
- No in-house KYC/sanctions data — buy a vendor (Chainalysis/TRM/Elliptic) rather than building attribution data, which costs millions and years to get right (see PCD §8).

**Rule of thumb applied throughout:** build the interface (so swapping later is cheap — that's SOLID's OCP/DIP doing the work), but don't build the second implementation until it's actually needed.

### 2.6 Supporting Techniques

- **Fail-fast, not fail-silent.** Any component that can't verify a fact (chain state, rate validity, compliance status) rejects or holds the transaction rather than guessing and proceeding. Silent fallback to a "probably fine" state is not acceptable in a payments system.
- **Idempotency by design.** Every state-changing operation (deposit detection, settlement execution, webhook delivery) is keyed by an idempotency key (`intent_id` + `event_type`) so retries — which *will* happen with unreliable chain infrastructure — never double-process.
- **Twelve-Factor config.** All environment-specific values (RPC URLs, API keys, feature flags) come from environment/config service injection, never hard-coded — this is SSOT applied to configuration specifically.
- **Separation of read and write models where they diverge.** The Ledger is written as strict double-entry events; dashboards read from a projection/materialized view — this keeps the SSOT (the event log) simple while still allowing fast reads.

---

## 3. Module Boundaries (SRP Applied to the Whole System)

```
┌────────────────────────────────────────────────────────────┐
│                     API / Webhook Layer                     │  ← owns: request validation, auth, rate limiting
├────────────────────────────────────────────────────────────┤
│  Payment Intent   │  Routing    │  Risk & Rate  │ Settlement │  ← owns: one concern each (SRP)
│  Service          │  Engine     │  Lock Engine  │  Service   │
├────────────────────────────────────────────────────────────┤
│              Chain Abstraction Layer (DRY boundary)          │  ← owns: all chain-specific detail, once
├────────────────────────────────────────────────────────────┤
│  Recovery  │ Reconciliation │ Compliance  │ Merchant Config  │  ← owns: one concern each (SRP)
├────────────────────────────────────────────────────────────┤
│               Persistence (Postgres, append-only ledger)     │  ← owns: SSOT storage
└────────────────────────────────────────────────────────────┘
```

Each horizontal band only calls **downward** through defined interfaces — never sideways into another band's internals, and never upward. This is what keeps the Open/Closed principle enforceable: a new chain, a new bridge provider, or a new risk rule is added by extending a band, not by reaching into another one.

---

## 4. Key Interface Contracts (Dependency Inversion in Practice)

These are the actual seams in the codebase — the interfaces that let providers, chains, and rules be swapped without touching core logic.

### 4.1 Routing Provider (swap LI.FI ↔ Socket ↔ Across without touching the Routing Engine)

```typescript
interface IRouteProvider {
  getName(): string;
  quote(params: RouteQuoteParams): Promise<RouteQuote>;
  execute(route: RouteQuote): Promise<RouteExecutionResult>;
  getStatus(executionId: string): Promise<RouteStatus>;
}

// Routing Engine depends only on this interface (DIP):
class RoutingEngine {
  constructor(private providers: IRouteProvider[]) {}

  async selectBestRoute(intent: PaymentIntent): Promise<RouteQuote> {
    const quotes = await Promise.all(this.providers.map(p => p.quote(intent)));
    return this.scoreAndSelect(quotes); // fee + time + security scoring — one place, testable in isolation
  }
}
```

Adding Squid as a fourth provider means writing `SquidRouteProvider implements IRouteProvider` and registering it — zero changes to `RoutingEngine`.

### 4.2 Chain Client (the DRY boundary for all chain-specific logic)

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

Every service that needs to talk to a chain (Chain Watcher, Settlement, Recovery, Gas Abstraction) depends on `IChainClient`, never on chain-specific SDKs directly. Chain-specific quirks (Tron's energy/bandwidth model vs. EVM gas, Solana's slot-based finality vs. EVM block confirmations) are implemented exactly once, inside each chain's adapter — this is the concrete DRY payoff.

### 4.3 Risk Scorer (Interface Segregation — compliance logic never touches routing logic)

```typescript
interface IRiskScorer {
  screenAddress(address: string, chain: string): Promise<RiskResult>;
}

// Vendor-specific adapters implement this narrowly-scoped interface:
class ChainalysisRiskScorer implements IRiskScorer { /* ... */ }
class TRMLabsRiskScorer implements IRiskScorer { /* ... */ }
```

Switching compliance vendors (see PCD §8 — likely as the product scales from API-first to Chainalysis) is a config/DI change, not a Risk Engine rewrite.

### 4.4 Repository Pattern (SSOT enforcement at the code level)

```typescript
interface IPaymentIntentRepository {
  create(intent: NewPaymentIntent): Promise<PaymentIntent>;
  transition(id: string, event: IntentEvent): Promise<PaymentIntent>; // the ONLY way state changes
  findById(id: string): Promise<PaymentIntent | null>;
}
```

No service is allowed to write to the `intents` table directly — every state change goes through `transition()`, which enforces the state machine's valid-transition rules in one place. This is SSOT enforced structurally, not just by convention.

---

## 5. Design Patterns Used, and Why Each One Earns Its Place

| Pattern | Where | Why (not just "it's a pattern") |
|---|---|---|
| **Strategy** | Routing Engine provider selection | Lets route-scoring logic vary independently of which providers exist (OCP) |
| **Adapter** | Chain Abstraction Layer | Normalizes wildly different chain SDKs behind one interface (LSP) |
| **Repository** | All persistence access | Enforces SSOT — no component bypasses the repository to touch storage directly |
| **State Machine** | Payment Intent lifecycle | Makes illegal state transitions structurally impossible, not just "usually avoided" |
| **Circuit Breaker** | Calls to RPC providers, bridge aggregators, compliance vendors | External dependencies fail; a stuck upstream call should degrade one path, not cascade into the whole request |
| **Event-Driven Notification** | Webhook delivery on intent state transitions | Decouples "something happened" from "who needs to know" — new consumers subscribe without touching the emitter |
| **CQRS-lite** | Ledger (write) vs. dashboard/reporting (read) | Keeps the SSOT write path simple (append-only) while reads can be optimized separately |

**Explicitly avoided:** generic "enterprise" patterns that add indirection without solving a real problem here — no abstract factory chains, no speculative plugin frameworks, no premature event-sourcing of *everything* (only the ledger needs append-only event semantics; the Merchant Config table is just a normal mutable table because YAGNI — it doesn't need history replay yet).

---

## 6. Configuration as SSOT

- All config lives in one schema-validated config service/file per environment (`config/{env}.yaml` or a secrets manager), never scattered across `.env` files with silently-diverging copies.
- Feature flags for chain/asset rollout (e.g., enabling a new chain) are read from this single source at request time, not baked into deploy-time constants — this lets ops turn a chain on/off without a redeploy.
- Merchant-specific settings (settlement asset, accepted chains, webhook URL) live only in Merchant Config Service; no other service is allowed to cache them beyond a short TTL.

---

## 7. Suggested Repository Layout

```
/services
  /payment-intent-service      # SRP: intent lifecycle only
  /routing-engine              # SRP: path selection only
  /risk-rate-engine            # SRP: quote locking + risk screening
  /settlement-service          # SRP: payout execution only
  /recovery-service            # SRP: misdirected/under/overpaid handling
  /reconciliation-service      # SRP: ledger + accounting export
/libs
  /chain-abstraction           # DRY boundary — one implementation per chain
    /evm
    /tron
    /solana
  /shared-errors                # one error taxonomy, imported everywhere
  /shared-webhooks               # one delivery/retry mechanism
  /shared-config                 # SSOT config loader/schema
/interfaces                     # shared TypeScript interfaces (IRouteProvider, IChainClient, etc.)
```

Each `/services/*` folder is independently deployable (or not) — the folder boundary is what keeps SRP honest even before any of them need to physically scale apart from the monolith.

---

## 8. Anti-Patterns This Team Explicitly Rejects

- **God service:** any component accumulating unrelated responsibilities (e.g., a "PaymentService" that quotes routes *and* screens compliance *and* sends webhooks) gets split before it ships, not after.
- **Shadow state:** a second place that "also" tracks whether a payment is confirmed, separate from the Chain Watcher's record — always a bug waiting to desync.
- **Copy-paste chain support:** adding a new chain by duplicating an existing chain adapter file and hand-editing it, instead of implementing `IChainClient` cleanly — this is exactly the DRY failure mode this architecture is built to prevent.
- **Silent catch blocks:** swallowing an error from a chain RPC call or a bridge provider and proceeding as if it succeeded — violates fail-fast and risks settling on bad data.
- **Config drift:** any hard-coded RPC URL, API key, or chain parameter checked into code instead of pulled from the SSOT config layer.

---

## 9. How This Maps to Code Review

A PR should be rejected (or sent back) if it:
- Adds a second writer to data that already has an SSOT owner (§2.1).
- Adds chain-specific logic outside the Chain Abstraction Layer (§2.4, §4.2).
- Makes the Routing Engine, Risk Engine, or any core service depend on a concrete provider class instead of its interface (§2.3 DIP).
- Introduces a new abstraction layer, plugin system, or configurability that has no current caller (§2.5 YAGNI).
- Duplicates logic that already exists in `/libs` instead of extending or reusing it (§2.4 DRY).
- Bypasses the repository layer to write to a table directly (§4.4).

This document is the reference for that review — not a one-time design exercise, but the standard the codebase is expected to hold itself to as it grows.

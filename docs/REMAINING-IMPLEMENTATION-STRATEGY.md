# Crypto Gateway — Remaining Implementation Strategy

**Status:** Draft for execution
**Scope:** Everything between the current code-complete-but-simulated state and a mainnet-capable gateway
**Delivery model:** Staged, testnet-first. Real third-party integrations, no real custody until the custody gate is passed.
**Custody target:** AWS KMS asymmetric keys (ECDSA secp256k1 + EdDSA ed25519)
**Baseline:** 448/448 tests passing, all 10 service packages present as libraries, tree clean

---

## 1. Purpose of this document

This is the execution plan for the remaining work. It answers four questions:

1. **What is actually missing** (not what the phase checkboxes claim).
2. **In what order** it must be built, given that some pieces are hard blockers for testing others.
3. **How** each piece is built so it is secure, efficient, and structurally consistent with what already exists.
4. **How we know it is done** — measurable acceptance criteria and gates, not vibes.

It intentionally does not re-plan Phases 0–10. Those are real. Read `docs/COMPLETE-SERVICES-ROADMAP.md` for the deployment narrative and `IMPLEMENTATION-PLAN.md` for historical phase intent.

---

## 1a. Findings discovered during execution

Defects found while implementing Sprint 0 and WS1 that the plan did not predict.
Recorded here because each one invalidated an assumption.

| # | Finding | Impact | Status |
|---|---|---|---|
| F1 | **The state machine could not reach `AWAITING_PAYMENT`.** No `EventType` mapped to it, so `awaitPayment()` attempted `QUOTED → QUOTED` and threw. Because `VALID_TRANSITIONS` allows only `AWAITING_PAYMENT → DETECTED`, `DEPOSIT_DETECTED` was **unreachable**. The file contained the author's own unresolved notes (`// Actually we want to transition from QUOTED to AWAITING_PAYMENT`). | No payment could ever be recorded, regardless of what else was built. Every integration test would have been invalid. | Fixed: added `PAYMENT_AWAITED` event type, wired `awaitPayment()`, added regression tests |
| F2 | **`PaymentIntent.deposit_address` was typed `string` but had no database column.** The value was only in the `QUOTE_GENERATED` event payload, so it was `undefined` at runtime and the watcher had no indexed way to resolve a transfer to an intent. | Deposit attribution was impossible without scanning JSONB per block. | Fixed: migration 010 adds the columns, backfills from events, and indexes `(deposit_chain, deposit_address)` |
| F3 | **`npm run lint` fails on pre-existing files** (~417 errors across 30+ files, e.g. `api-gateway/src/index.ts`, `db/src/connection.ts`). | The CI `lint` job is red today, so the pipeline has never been green end to end. A red pipeline means real failures are invisible. | Reported — needs a decision (see §16) |
| F4 | **CI built Dockerfiles that did not exist** and the `Dockerfile.base`/`Dockerfile.api-gateway` pair could not build (`FROM base` referenced an image nothing produced). Salt in the wound: five more packages were in the matrix with no Dockerfile at all. | The docker job could never pass. | Fixed: one parameterized `docker/Dockerfile.service`, matrix reduced to real processes |
| F5 | **`.env.example` pointed at Polygon Mumbai**, decommissioned, and documented no signing, routing, paymaster, oracle or worker variables. | New integrations would be configured from a stale template. | Fixed |

---

## 2. Honest baseline: what is real vs. simulated

### 2.1 Genuinely solved (the trust and accounting core)

| Capability | Evidence |
|---|---|
| Intent state machine + append-only `intent_events` | `packages/payment-intent/src/payment-intent.service.ts` |
| Postgres persistence + optimistic locking | `packages/payment-intent/src/payment-intent.repository.ts`, 9 migrations |
| Double-entry ledger | `packages/settlement/src/ledger.service.ts` + `ledger.repository.ts` |
| Reconciliation logic | `packages/reconciliation/src/reconciliation.service.ts` |
| Chain client interfaces + implementations | `packages/chain-abstraction/src/{evm,tron,solana}` |
| Rate-lock semantics with TTL + compliance gate | `packages/rate-lock/src/rate-lock.service.ts`, `compliance-gate.ts` |
| Recovery as a first-class business state | `packages/recovery/src/recovery.service.ts` |
| Merchant config, webhook delivery, API auth | `packages/payment-intent/src/{merchant-config,webhook-delivery,auth}.service.ts` |
| API gateway with auth + intent routes | `packages/api-gateway/src/routes/intents.ts` |

### 2.2 Simulated — must be replaced before real value moves

| Capability | Current state | Blast radius if shipped |
|---|---|---|
| Cross-chain routing | `mock-lifi-provider.ts`, `mock-socket-provider.ts` are the *only* providers | Quotes are fictional; settlement routes would be wrong |
| Sanctions / KYT screening | `ChainalysisRiskScorer.callChainalysisRisk()` returns `simulateRiskScore()` — no HTTP call, `Math.random()` exposure | **Illegal.** Screening that does not screen is worse than none |
| Oracle | `ChainlinkOracle` always rejects; only CoinGecko path returns data, no failover | Rate-lock / settlement pricing unreliable |
| Settlement signing | `signTransaction()` returns `0x{from}{to}`; `getSettlementAddress()` returns zero address | **Money cannot move.** Nothing settles |
| Gas abstraction | Hardcoded `nativePriceUsd` in `DEFAULT_CHAIN_CONFIGS`; no paymaster/relayer client | Gasless quotes wrong; users cannot pay without native token |
| USD valuation | `EVMChainClient` hardcodes `totalCostUSD = 0`, `amountUSD: 0` | Ledger and risk limits both blind |
| Webhook / settlement retries | In-process `setTimeout` + stubbed `getRetryCount()` | Retries lost on restart; no backoff durability |
| Deposit → intent wiring | `watchDeposits()` is never called by any runnable process | **No payment can ever be detected** |
| Service runtime | Only `api-gateway` has an entrypoint | 6 services are unreachable libraries |

### 2.3 The single most important observation

The gateway today solves the **bookkeeping** half of the problem correctly and the **custody + external-reality** half not at all. Every item in `2.2` touches either real money or a real third party. That is why the sequencing below leads with *making the system runnable and testable*, then *making it real*.

---

## 3. Guiding principles

These are non-negotiable and every workstream below is checked against them.

1. **Nothing runs in-process that must survive a restart.** Jobs, retries, and watches live in Postgres or Redis, never in `setTimeout` closures.
2. **Every state transition is idempotent and auditable.** Same intent + same event = same result, and the event is appended once. Idempotency keys are mandatory on every inbound and outbound boundary.
3. **No secret ever enters a signed payload or a log line.** Signing happens inside KMS. The signer abstraction returns signatures, never key material. Structured-log redaction is enforced in one place.
4. **Adapters are interfaces first.** Every external dependency gets (a) an interface in `@crypto-gateway/shared`, (b) a real adapter, (c) a deterministic fake for tests. Mocks move behind `NODE_ENV=test`, never behind a production default.
5. **Fail closed on compliance, fail open only where explicitly justified.** Screening errors block (or queue for manual review); price-feed errors reject the quote. A `createSafeDefault()` that returns `riskScore: 0` on API failure is a compliance hole and gets removed.
6. **Testnet parity.** The exact code path exercised on Base Sepolia is the one that runs on Base. Only config differs. No `if (testnet)` branches in business logic.
7. **New dependency = ADR.** This repo is deliberately lean (`pg`, `ethers`, `fastify`). Anything added must be justified in `docs/adr/`.

---

## 4. Target architecture (what changes)

```
                       ┌─────────────────────────────────────┐
   merchant ─────────► │  api-gateway (Fastify)              │
                       │  REST + auth + webhook dispatch     │
                       └───────┬─────────────────────────────┘
                               │ (intent commands, idempotency keys)
                       ┌───────▼─────────────────────────────┐
                       │  payment-intent (state machine)     │
                       └───────┬─────────────────────────────┘
                               │
        ┌──────────────────────┼───────────────────────────┐
        │                      │                           │
┌───────▼────────┐   ┌─────────▼──────────┐   ┌────────────▼─────────┐
│ deposit-watcher│   │ rate-lock + oracle │   │  compliance          │
│ (NEW worker)   │   │ (failover chain)   │   │  (real KYT + sanctions)│
└───────┬────────┘   └─────────┬──────────┘   └────────────┬─────────┘
        │                      │                           │
        │            ┌─────────▼──────────┐                │
        └───────────►│  routing-engine    │◄───────────────┘
                     │  LI.FI + Bungee    │
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐
                     │  gas-abstraction   │
                     │  4337 paymaster +  │
                     │  relayer clients   │
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐        ┌──────────────────┐
                     │  settlement        │───────►│ SignerProvider   │
                     │  (nonce mgr, ledger)│       │  AWS KMS (+fake) │
                     └─────────┬──────────┘        └──────────────────┘
                               │
                     ┌─────────▼──────────┐        ┌──────────────────┐
                     │  recovery          │───────►│  job-queue       │
                     │  (refund, RBF)     │        │  (Postgres/Redis)│
                     └────────────────────┘        └──────────────────┘
                               │
                     ┌─────────▼──────────┐
                     │  reconciliation    │
                     └────────────────────┘
```

### New shared interfaces to add (in `packages/shared/src/types/`)

| Interface | File | Consumed by |
|---|---|---|
| `ISignerProvider` | `types/signer.ts` | settlement, recovery, gas-abstraction |
| `IRiskScorer` (already exists) — tighten contract: `screenAddress` must throw `ScreeningUnavailableError`, not return a fake low score | `types/risk.ts`, `errors/compliance-errors.ts` | compliance, rate-lock |
| `IPriceOracle` — formalize with `getPrice(asset, quote)` + `getHealth()` | `types/oracle.ts` | rate-lock, gas-abstraction, settlement |
| `IDepositWatcher` | `types/deposit.ts` | payment-intent worker |
| `IJobQueue` | `types/jobs.ts` | webhooks, settlement retries, screening retries |
| `IPaymasterClient`, `IRelayerClient` | extend `types/gas-abstraction.ts` | gas-abstraction |

The `BaseRouteProvider` template-method shape in `packages/routing-engine/src/base-route-provider.ts` is good and is the pattern to copy for every new adapter (circuit breaker included).

---

## 5. Staged delivery: gates, not dates

Work proceeds through five gates. **A gate is not a milestone marker — it is a hard stop where the system must pass defined exit criteria before the next stage's work is merged to `main`.**

| Gate | Name | Exit criteria (all must hold) |
|---|---|---|
| **G0** | Runnable system | All services have entrypoints + `start` scripts; deposit → DETECTED → CONFIRMING works end-to-end locally on Base Sepolia with a real transaction; jobs survive a process restart |
| **G1** | Real data, no real money | Real LI.FI + Bungee quotes, real Chainalysis/TRM screening (or explicit `SCREENING_MODE=real` fail-closed), real price feeds with failover; settlement produces a *correct unsigned* transaction; E2E suite green in CI on testnet |
| **G2** | Custody live on testnet | KMS signing operational for EVM/Tron/Solana; nonce manager prevents duplicates under concurrent load; a full testnet payment settles to a merchant address; hot-wallet balance + sweep automation working |
| **G3** | Production-grade operations | IaC complete, metrics + alerts live, blue-green deploy + rollback rehearsed, on-call runbooks written, coverage gate enforced, dependency + secret scanning in CI |
| **G4** | Mainnet readiness | External audit complete on custody path, bug bounty live, mainnet smoke test with capped value, incident response rehearsed, exit criteria in §11 signed off |

Mainnet value flows **only after G4**. Stage gates G0–G3 are all testnet.

---

## 6. Workstreams

Six parallelizable workstreams. Each task below carries: *why*, *where*, *done when*, and *risk if skipped*.

---

### WS1 — Runtime orchestration (blocking everything)

**Problem:** Only `api-gateway` runs. `watchDeposits` is never called, so the intent state machine never advances past `CREATED`. No integration test can be meaningful until this is fixed.

**Architecture decision:** Do **not** give each package a long-running server just because K8s manifests exist. Run **one `worker` process** (new package `packages/worker`) that composes the services in-process under a scheduler, plus optionally split later by load. Rationale: fewer moving parts, one deploy, single migration owner. The K8s manifests for `settlement.yml`, `routing-engine.yml`, etc. become scale-out targets later, not immediate requirements.

> **ADR-001** must record this choice and the migration path to per-service processes.

#### Tasks

| # | Task | Where | Done when |
|---|---|---|---|
| 1.1 | Add `packages/worker` with entrypoint, graceful shutdown (SIGTERM → drain), structured logging | `packages/worker/src/index.ts` | `npm run dev -w packages/worker` starts and shuts down cleanly |
| 1.2 | Compose services: chain registry, intent service, rate-lock, compliance, routing, gas, settlement, recovery, reconciliation | `packages/worker/src/composition.ts` | One place constructs every service with injected deps (no module-level singletons) |
| 1.3 | Deposit watcher: subscribe to `watchDeposits` per configured chain, map `DepositEvent` → intent transitions with idempotency key `chain:txHash:logIndex` | `packages/worker/src/deposit-watcher.ts` | A testnet transfer to a deposit address advances the intent to `DETECTED` exactly once, even if the same event is delivered twice |
| 1.4 | Confirmation tracker: track depth per chain config (`confirmation_depth`), advance `DETECTED → CONFIRMING → CONFIRMED` | `packages/worker/src/confirmation-tracker.ts` | Reorg (simulated by rollback on a testnet fork) does not finalize |
| 1.5 | Job queue with durable storage + exponential backoff + dead-letter | `packages/worker/src/job-queue.ts` | Kill the worker mid-retry; on restart the job resumes from persisted state |
| 1.6 | Replace in-process `setTimeout` webhook retries and stubbed `getRetryCount()` | `webhook-delivery.service.ts`, `settlement.service.ts` | No `setTimeout` remains in retry paths (`grep` gate in CI) |
| 1.7 | Heartbeat + readiness: worker exposes `/health` and `/metrics`; gateway `/health/ready` reflects queue depth | worker + gateway | Readiness fails when the watcher's last-seen block is stale > N blocks |
| 1.8 | Chain reorg + finality policy per chain, documented | `packages/shared/src/types/chain-config.ts` | Chain config carries `confirmation_depth`, `finality: 'probabilistic' \| 'finalized'` |

**Queue backend decision:** Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`) is sufficient and adds no dependency — recommended given the repo already depends on `pg` and no Redis client exists. Introduce `ioredis`/`bullmq` only if throughput demands it (**ADR-002**).

**Optimization note:** Use Postgres `LISTEN/NOTIFY` for deposit events instead of polling where the RPC supports streams (EVM websockets, Tron solidity node, Solana `onLogs`), with polling as the reconciliation fallback. This cuts RPC cost substantially.

---

### WS2 — Custody and signing (highest risk)

**Problem:** `SettlementService.signTransaction()` returns a placeholder and `getSettlementAddress()` returns the zero address. This is the money path.

#### 2.1 `ISignerProvider` abstraction

```ts
export interface ISignerProvider {
  /** Stable key identifier, e.g. "evm-mainnet-hot" — never key material. */
  getKeyId(chainId: string): string;
  /** Address derived from the public key; resolved once and cached. */
  getAddress(chainId: string): Promise<string>;
  /** Sign a 32-byte digest. Must enforce low-S for secp256k1. */
  signDigest(chainId: string, digest: Uint8Array): Promise<Signature>;
  /** Sign a serialized transaction for the given chain family. */
  signTransaction(chainId: string, tx: UnsignedTx): Promise<SignedTx>;
  healthCheck(): Promise<{ healthy: boolean; keyId: string; lastError?: string }>;
}
```

Implementations:
- `AwsKmsSigner` (`packages/shared/src/signing/aws-kms-signer.ts` or a new `packages/signing`)
- `LocalKeystoreSigner` — dev/test only, AES-GCM encrypted file, **refuses to start if `NODE_ENV=production`**
- `FakeSigner` — deterministic, for unit tests

#### 2.2 AWS KMS key specs (verified)

| Chain family | Chains | KMS key spec | Signature algorithm |
|---|---|---|---|
| EVM | Ethereum, Base, Arbitrum, Optimism, Polygon | `ECC_SECG_P256K1` | `ECDSA_SHA_256` |
| Tron | Tron | `ECC_SECG_P256K1` | `ECDSA_SHA_256` |
| Solana | Solana | `ECC_NIST_EDWARDS25519` | `EDDSA` (AWS added EdDSA support Nov 2025) |

**Critical implementation details that bite people:**
1. KMS `Sign` returns **DER-encoded** ECDSA signatures. EVM and Tron require raw `r‖s` (64 bytes) — decode and re-encode, and **enforce low-S** or transactions are rejected/hash differently.
2. For Tron, KMS signs the SHA-256 of the raw tx; the `0x` `r` value needs no `v` byte in Tron's format, but requires the correct recovery id for EVM — compute `v` from the digest + signature, and verify by recovering the public key and comparing to `getAddress()`. Do this **once at startup per key**, not per transaction.
3. `GetPublicKey` must be called once and cached; do not call it per transaction (latency + KMS cost).
4. Key material never leaves KMS. No export. No `kms:Decrypt` on signing keys. Key policy restricts to the worker's IAM role only.

#### 2.3 Nonce management (a correctness bug waiting to happen)

KMS gives no nonce. Concurrent settlements from one hot wallet will collide and one will be dropped.

| # | Task | Done when |
|---|---|---|
| 2.3.1 | `NonceAllocator`: Postgres table `wallet_nonces(chain_id, address, next_nonce)` with `SELECT ... FOR UPDATE`; allocate-then-reserve lifecycle | Two parallel settlement calls get distinct nonces |
| 2.3.2 | Reconciliation loop: on startup and every N blocks, compare allocated nonces against `pending` txs from the RPC; release or re-anchor gaps | After a dropped tx, the wallet resumes without a gap deadlock |
| 2.3.3 | Stuck-tx policy: identical-nonce replacement with bumped fee (RBF) after `T` blocks | A stuck testnet tx is replaced and confirms |

#### 2.4 Hot-wallet operations

| # | Task | Done when |
|---|---|---|
| 2.4.1 | Balance checks before submit: native gas + token amount | Settlement refuses with a typed error (not a chain revert) when underfunded |
| 2.4.2 | Alerts on balance below threshold, per chain | Alert fires in testnet drill |
| 2.4.3 | Sweep job: move surplus from hot wallet to cold/target address on schedule | Sweep executes on testnet and is ledger-recorded |
| 2.4.4 | Per-chain, per-day spend limits enforced before signing | Limit breach blocks and emits an event |

#### 2.5 Structural safety

- Settlement becomes two-phase: **plan** (build + validate + persist intent to submit) → **execute** (sign + submit). The plan row is the idempotency anchor so a crash between sign and submit cannot double-spend.
- `settlements` table gains: `unsigned_tx_hash`, `signed_tx_hash`, `nonce`, `signer_key_id`, `attempt_count`, `last_error`, `submitted_at`.
- Admin-gated **emergency pause**: a flag in DB checked in the settlement critical section. Required before G3.

---

### WS3 — Real external adapters

All adapters follow `BaseRouteProvider`'s structure: constructor-injected config, circuit breaker, timeout, typed errors, normalizer.

#### 3.1 Routing (`packages/routing-engine/src/providers/`)

| Adapter | Endpoint surface | Notes |
|---|---|---|
| `LifiRouteProvider` | LI.FI Core API (`li.quest/v1`): `/quote`, `/advanced/routes`, `/status` | Quote endpoints default to ~100 rpm per API key — **cache aggressively and respect 429 with backoff**. Use a partner-portal API key. |
| `BungeeRouteProvider` (Socket successor) | Bungee/Socket quote + status API | Second independent route source; needed for real route comparison, not just failover |

Tasks:
1. Add `http-client.ts` in shared: fetch with timeout (`AbortSignal.timeout`), retry with jittered backoff, circuit breaker, request-id propagation, and **redaction of API keys from logs**.
2. Replace `MockLiFiProvider`/`MockSocketProvider` exports from `index.ts` with real providers; move mocks to `src/providers/__mocks__/` used only under test config.
3. Normalize provider-specific quirks into the existing `RouteQuote` shape — do not change the shared type.
4. Persist every raw provider response for dispute/audit (`routing_quotes` table) with the normalized quote.
5. `getStatus` polling must be durable (WS1 job queue), not in-memory.
6. Enable `route-scorer` across **both** live providers so the existing scoring logic actually does something.

**Testnet constraint that shapes rollout:** cross-chain bridges on testnets have thin liquidity and frequently broken routes. Plan for a **local-fork route provider** (Anvil/Hardhat fork + a test bridge) or accept that G1 route validation is done against mainnet *quotes* with testnet *execution* for single-chain legs only. Document this explicitly rather than discovering it during the gate.

#### 3.2 Compliance (`packages/compliance/src/`)

**Delete `createSafeDefault()`.** Its current behaviour — returning `riskScore: 0, riskLevel: 'LOW'` when the API is unreachable — is a compliance failure that silently approves every address during an outage.

| # | Task | Done when |
|---|---|---|
| 3.2.1 | Real `ChainalysisRiskScorer` HTTP call: `Token` header auth, `/api/2/address/{address}`, map `risk` + `identifications` into `RiskResult` | A known-sanctioned testnet address is flagged `SANCTIONED` |
| 3.2.2 | Real `TRMLabsRiskScorer` (second source, cross-check) | Both scorers can run; disagreement policy defined |
| 3.2.3 | Fail-closed: API error → `ScreeningUnavailableError` → intent enters `MANUAL_REVIEW`, never `CONFIRMED` | Simulate 500/timeout; payment does not proceed |
| 3.2.4 | Sanctions list fallback: maintain OFAC SDN + EU + UN lists locally (refreshed daily) so sanctions screening still works offline | Kill the KYT API; sanctioned address still blocked |
| 3.2.5 | Screening cache correctness: key must be `address:chain:screeningMode`, with TTL; **no cached score across risk-policy changes** | Cache invalidation test |
| 3.2.6 | Velocity checker backed by DB aggregates, not in-memory | Restart preserves velocity state |
| 3.2.7 | Audit trail: every screening call persisted with request id, response hash, decision | Query by intent returns full screening history |

Contract with partners: Chainalysis KYT and TRM are paid, contractual integrations. **Start procurement at the beginning of G0** — API access lead time is typically weeks and it is a hard gate for G1.

#### 3.3 Price oracles (`packages/rate-lock/src/price-oracle.service.ts`)

| # | Task | Done when |
|---|---|---|
| 3.3.1 | Ordered failover chain: primary (CoinGecko) → secondary (Chainlink on-chain for supported pairs) → tertiary (provider #2, e.g. Binance/Kaiko) | Kill primary; price still resolves |
| 3.3.2 | Staleness guard: reject prices older than `max_age_seconds`; reject deviation > X% from the median of sources | Simulated stale feed is rejected |
| 3.3.3 | Real `ChainlinkOracle` implementation via `latestRoundData()` on aggregated feeds (EVM only), with `updatedAt`/`answeredInRound` validation | On-chain read returns a validated price |
| 3.3.4 | Backoff + quota tracking for CoinGecko (free tier is rate-limited); cache with per-asset TTL | No 429 storms in load test |
| 3.3.5 | Populate `amountUSD` and `totalCostUSD` in `EVMChainClient` from the oracle instead of `0` | Ledger entries show non-zero USD |

#### 3.4 Gas abstraction (`packages/gas-abstraction/src/`)

| # | Task | Done when |
|---|---|---|
| 3.4.1 | Remove hardcoded `nativePriceUsd`; read from oracle | ETH price change reflects in estimates |
| 3.4.2 | Real paymaster client (ERC-4337): Pimlico or Alchemy — `pm_getPaymasterData` / `pm_sponsorUserOperation` | A sponsored testnet userOp executes without the user holding ETH |
| 3.4.3 | Real relayer client for non-AA EVM chains + Tron energy/bandwidth delegate | Tron transfer executed with rented energy |
| 3.4.4 | Live `eth_estimateGas` / Tron `estimateEnergy` / Solana compute-unit budget, replacing static gas limits | Estimate within tolerance of actual |
| 3.4.5 | Sponsorship policy enforcement (whitelist / amount caps / token allow-list) before requesting sponsorship | Over-cap request rejected locally |
| 3.4.6 | Track and cap sponsorship spend per merchant per day | Cap breach blocks |
| 3.4.7 | Evaluate EIP-7702 as an alternative to 4337 for EOA-held funds; record as **ADR-003** | Decision recorded |

#### 3.5 Testnet chain corrections

- `POLYGON_RPC_URL` in `.env.example` points at **Mumbai, which is deprecated** — switch to Polygon Amoy.
- Add testnet entries for Base Sepolia (present), Arbitrum Sepolia (present), Sepolia (present), Tron Nile (present), Solana Devnet (present). Add Amoy and verify every RPC responds in a CI smoke test.

---

### WS4 — DevOps, CI/CD, observability

#### 4.1 CI is currently broken-by-design

`.github/workflows/ci.yml` builds `Dockerfile.routing-engine|settlement|compliance|recovery|reconciliation`, but `docker/` only contains `api-gateway`, `chain-abstraction`, `payment-intent`, `base`. **The docker matrix job cannot pass.**

| # | Task | Done when |
|---|---|---|
| 4.1.1 | Add `Dockerfile.worker` (and align the matrix with reality) | Docker matrix green on `main` |
| 4.1.2 | Multi-stage builds: build stage → distroless/non-root runtime; no dev deps in the final image | Image runs as UID 10001, no shell |
| 4.1.3 | Trivy scan must fail the build on HIGH/CRITICAL, not just report | Simulated vulnerable base image fails CI |
| 4.1.4 | `npm audit --audit-level=high` gating | Advisory fails build |
| 4.1.5 | Secret scanning (gitleaks) + `grep` gates: no `setTimeout` in retry paths, no `mock` import reachable from a production entrypoint | Gates enforced |
| 4.1.6 | Coverage gate: thresholds in `vitest.config.ts`, ratchet up to ≥80% on the money path (`settlement`, `payment-intent`, `compliance`, `rate-lock`) | CI fails below threshold |

#### 4.2 Kubernetes

| # | Task | Done when |
|---|---|---|
| 4.2.1 | Add missing manifests: `worker.yml`, `rate-lock.yml`, `gas-abstraction.yml`, `ingress.yml`, `hpa.yml`, `pdb.yml`, `db-backup-cronjob.yml`, `service-accounts.yml` | `kubectl apply --dry-run=server` clean |
| 4.2.2 | `securityContext` on **every** pod: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, seccomp `RuntimeDefault` | Policy check (Kyverno or Conftest) enforces |
| 4.2.3 | Resource requests/limits on every container, with HPA on worker + gateway | Load test does not OOM |
| 4.2.4 | Secrets via External Secrets Operator → AWS Secrets Manager (or Vault); no plaintext `secrets.yml` in git | No secret literals in the repo |
| 4.2.5 | Network policies: default-deny egress, explicit allow-list per service (RPC endpoints, KYT APIs, LI.FI). Note K8s NetworkPolicy is not an SSRF defence — enforce outbound host allow-list in the HTTP client too | Egress to an unlisted host is blocked |
| 4.2.6 | IRSA: worker pod gets an IAM role scoped to `kms:Sign` + `kms:GetPublicKey` on specific key ARNs only | Denied for any other key |
| 4.2.7 | `config/staging.yaml` added; config loading validates against a schema at boot and fails fast | Missing required key = crash on start, not at first payment |

#### 4.3 Observability

`prometheus.yml` and `grafana.yml` exist but **no service exposes metrics**. This is the difference between "we have dashboards" and "we can see an incident".

| # | Task | Done when |
|---|---|---|
| 4.3.1 | Add `prom-client` (or an OTel-lite exporter) with `/metrics` on gateway + worker. **ADR-004** for exporter choice | `/metrics` returns real series |
| 4.3.2 | RED metrics on every HTTP boundary; chain-specific gauges: `watcher_last_seen_block`, `queue_depth`, `job_age_seconds`, `screening_latency_ms`, `oracle_deviation_bps`, `hot_wallet_balance`, `settlement_duration_ms`, `nonce_gap_count` | Dashboards render with live data |
| 4.3.3 | OpenTelemetry traces with a `correlation_id` propagated gateway → worker → adapters → webhook | One payment traceable end-to-end in Jaeger |
| 4.3.4 | Alert rules with runbook links: screening API down, oracle stale, watcher lag, queue growth, wallet low, settlement failure rate, KMS `ThrottlingException` | Each alert fires in a drill |
| 4.3.5 | Structured logging with redaction (keys, tokens, PAN-like data, API keys) centralized in the logger config | Log-scrub test passes |

#### 4.4 Deployment

| # | Task | Done when |
|---|---|---|
| 4.4.1 | Blue-green or canary release with automated rollback on error-rate/health regression | Rollback rehearsed in staging |
| 4.4.2 | Migrations: forward-only, expand/contract pattern, run as a pre-deploy Job with advisory lock | Two concurrent deploys cannot both migrate |
| 4.4.3 | Backups: `pg_dump`/WAL archiving to S3, plus a **tested restore** | Restore into staging verified and timed |
| 4.4.4 | DR plan with RTO/RPO targets | Documented and exercised once |

---

### WS5 — Testing and QA

Current state: 448 unit tests, one integration test that imports mocks and needs live Postgres, and `tests/load/load-test.yml` that has never run. No E2E.

| Layer | Purpose | Requirements |
|---|---|---|
| Unit | Pure logic, state machine, scoring, signers with `FakeSigner` | ≥80% on money-path packages |
| Contract | Each adapter against recorded provider fixtures (nock/VCR) **plus** an opt-in live smoke test on `main` | Fixtures committed; live smoke runs nightly |
| Integration | Real Postgres + Redis (testcontainers or compose), real migrations | Runs in CI with a service container |
| E2E (new, `tests/e2e/`) | `create intent → pay on testnet → detected → screened → routed → settled → webhook delivered` | Funded testnet accounts; runs on a schedule and pre-release |
| Chaos | Kill worker mid-settlement; drop RPC; 500 from KYT; KMS `ThrottlingException` | System reaches a consistent state, no double-spend, no lost event |
| Load | k6 (`tests/load/`) against staging: intent creation + status polling + webhook throughput | SLOs met; results published |
| Security | Trivy, npm audit, gitleaks, `semgrep` rules for the money path, plus an adversarial review of signing/nonce code | No HIGH/CRITICAL unaddressed |

**Idempotency tests are mandatory and are the highest-value tests in this project:** duplicate deposit event, duplicate webhook delivery, duplicate settlement submit, crash between sign and submit.

**SLOs to define now (needed for alerting):**
- Intent creation p99 < 300 ms
- Deposit detection → `DETECTED` < 15 s (p95) per chain
- Screening latency p95 < 2 s (excluding provider outage)
- Settlement submitted → confirmed within chain-appropriate window (p95)
- Webhook delivery success ≥ 99.5% within 5 min
- Availability target: 99.9% for intent creation and status API

---

### WS6 — Smart contracts, docs, dashboard, launch

#### 6.1 Smart contracts (Phase 13 — currently not started)

`packages/contracts` does not exist. Before G4:

| # | Task | Done when |
|---|---|---|
| 6.1.1 | Scaffold Foundry project: deposit-address factory (CREATE2, deterministic per intent), settlement receiver with allow-list, emergency pause | Deployed to Base Sepolia and verified |
| 6.1.2 | Access control: owner, pauser, settler roles; two-step ownership handover | Role matrix test |
| 6.1.3 | Allow-list enforcement: settlement can only send to merchant-registered addresses | Attempt to settle elsewhere reverts |
| 6.1.4 | Tests: unit + fuzz + invariant (`invariant`: contract balance ≥ sum of pending). Slither/Mythril in CI | Invariant suite passes |
| 6.1.5 | External audit of contracts **and** the signing/nonce path; remediate findings | Report published; criticals closed |
| 6.1.6 | Bug bounty live (Immunefi-style) before mainnet value | Program published |
| 6.1.7 | Deterministic deposit addresses derived from the signer's address, not a hot key — reduces key exposure | ADR-005 |

#### 6.2 Documentation (five files referenced by the roadmap that do not exist)

| File | Content | Gate |
|---|---|---|
| `docs/API-DOCUMENTATION.md` + `docs/api/openapi.yaml` | OpenAPI 3.1 for the gateway: intents, auth, status, webhooks with HMAC signing spec | G1 |
| `docs/MERCHANT-GUIDE.md` | Onboarding: API key issuance, webhook verification, testnet→mainnet checklist, supported chains/assets | G1 |
| `docs/OPERATIONS-RUNBOOK.md` | Migration, deploy, rollback, key rotation, wallet top-up, oracle failover, queue drain, DB restore | G3 |
| `docs/INCIDENT-RESPONSE.md` | Severity levels, on-call, escalation, comms templates, chain-halt/suspected-compromise playbooks | G3 |
| `docs/SECURITY-POLICY.md` | Disclosure policy, data handling, retention, key management policy, compliance posture | G3 |

Also: **populate `IMPLEMENTATION-PLAN.md` checkboxes** so the repo stops claiming zero progress, and add a short ADR index.

#### 6.3 Dashboard

| # | Task | Done when |
|---|---|---|
| 6.3.1 | Fix `API_BASE` default: dashboard defaults to `:3002`, gateway listens on `:3000` | Dashboard loads live data |
| 6.3.2 | Replace the 6 pages still rendering `lib/mock-data.ts` with live API calls + loading/error/empty states | No `mock-data` import reachable from a page |
| 6.3.3 | Auth: merchant-scoped sessions; never expose another merchant's intents | Authorization test |
| 6.3.4 | Surface operational state honestly: screening status, settlement hash, chain, confirmations | Merchant can self-serve status |

#### 6.4 Launch

Pre-mainnet checklist: legal/compliance sign-off, custody review, audit closed, bounty live, runbooks rehearsed, staging soak ≥ 2 weeks, capped mainnet smoke test, support channel staffed, rollback plan tested, insurance/treasury policy decided.

---

## 7. Dependency graph and critical path

```
WS1 (runnable)  ──┬─► WS3.2 compliance ──► G1 ──► WS2 signing ──► G2 ──► WS4 ──► G3 ──► WS6 contracts/audit ──► G4
                  ├─► WS3.1 routing   ──┘                    ▲
                  ├─► WS3.3 oracles   ──┘            WS5 E2E ─┘
                  └─► WS3.4 gas ──────┘
WS4.1 (CI fix) ─── can start immediately, unblocks every merge
WS6.2 (docs)   ─── can start immediately in parallel
```

**Critical path:** WS1.3 (deposit watcher) → WS3.2 (compliance, gated by vendor procurement lead time) → WS2 (KMS signing + nonce manager) → WS6.1 (contracts + audit).

**Two long-lead items that must start on day 1 or they become the real bottleneck:**
1. **Compliance vendor contracts** (Chainalysis KYT, TRM) — weeks of procurement.
2. **External audit scheduling** — auditors book out; a 6-week engagement booked late pushes mainnet by months.

---

## 8. Execution sequence

### Sprint 0 — Unblock (immediate, parallel)
- 4.1.1–4.1.6: fix CI, add `Dockerfile.worker`, enforce gates.
- Kick off compliance vendor procurement.
- Kick off audit conversation (scope: contracts + signing path).
- **ADR-001** worker vs. per-service, **ADR-002** queue backend, **ADR-004** metrics.
- Prune or quarantine dead K8s manifests so the repo stops implying services that do not exist.

### Sprint 1 → Gate G0: make it run
WS1 fully (1.1–1.8). Exit: a real Base Sepolia transfer advances an intent to `CONFIRMED` locally, survives a worker restart, and is covered by a new integration test.

### Sprint 2–3 → Gate G1: make it real, no real money
WS3.2 (compliance, fail-closed), WS3.3 (oracle failover + USD valuation), WS3.1 (LI.FI + Bungee). WS5: adapter contract tests, E2E harness, load test baseline. Exit criteria in §5.

### Sprint 4–5 → Gate G2: custody on testnet
WS2 fully (KMS signer, nonce manager, two-phase settlement, wallet ops, pause). Chaos tests: kill worker mid-settlement, throttle KMS, duplicate submit. Exit: full testnet settlement + correct ledger + reconciliation to zero.

### Sprint 6–7 → Gate G3: production-grade ops
WS4 (obs, alerts, IaC, blue-green, backups + restore drill), WS6.2 (runbooks, incident response), coverage gate at ≥80% on money path, staging soak.

### Sprint 8+ → Gate G4: contracts, audit, launch
WS6.1 (contracts + audit + bounty), mainnet smoke with caps, WS6.3 dashboard live, WS6.4 launch checklist.

Durations depend on team size; the **ordering is the deliverable**, not the calendar.

---

## 9. Security strategy

### 9.1 Threat model highlights

| Threat | Control |
|---|---|
| Hot-wallet key exfiltration | Keys only in KMS; no export; worker IAM scoped to specific key ARNs via IRSA; no key material in memory or logs |
| Malicious insider / compromised service | Two-phase settlement, allow-listed destinations, per-day spend caps, emergency pause, immutable audit log |
| SSRF via merchant- or chain-controlled URLs | Webhook URLs validated + allow-list + no redirects + no private IPs; outbound RPC allow-list at the HTTP client layer |
| Replay / duplicate settlement | Idempotency keys on every boundary; unique constraints in Postgres as the last line of defence |
| Double-spend from nonce collisions | `NonceAllocator` with row locks + startup reconciliation; concurrency test mandatory |
| Compliance bypass during outage | Fail-closed screening + local sanctions lists |
| Webhook forgery | HMAC-SHA256 over raw body with timestamp, replay window, per-merchant secret, key rotation |
| Supply chain | Lockfile integrity (`npm ci`), Dependabot/Renovate, `npm audit` gate, Trivy gate, pinned base images |
| Data exposure | Minimal PII, encryption at rest (RDS + Redis TLS), retention policy, no sensitive data in metrics labels |
| RPC provider as single point of trust | Multi-provider RPC per chain with quorum/fallback; never trust a single RPC for confirmation depth |

### 9.2 Key management policy

- One KMS key per chain **family** role, aliased (`alias/cgw-evm-hot`, `alias/cgw-tron-hot`, `alias/cgw-solana-hot`); separate keys for testnet and mainnet.
- Key policy: only the worker role may `Sign`/`GetPublicKey`. No `kms:ScheduleKeyDeletion` for any human role without MFA + approval.
- CloudTrail on every `Sign` call, alerted on anomalous rate.
- Rotation: documented procedure with a new deposit-address epoch; old addresses remain watchable forever for credits.
- Sig verification on startup: recover the pubkey from a test signature and assert it matches `getAddress()`. Fail boot if not.

### 9.3 Structural security invariants (assert in code)

1. `NODE_ENV=production` ⇒ signer is `AwsKmsSigner`. `LocalKeystoreSigner` throws on construction in production.
2. No adapter in `index.ts` export paths may resolve to a `mock-*` module outside of test config. Add a CI `grep` gate.
3. Settlement destination must be a registered, allow-listed merchant address — validated in the service, not just the API.
4. Every ledger write is inside the same transaction as the state transition it reflects.
5. `amountUSD`, `totalCostUSD` must never be `0` for a settled non-zero amount — add an assertion/test.

---

## 10. Optimization strategy

| Area | Optimization | Expected effect |
|---|---|---|
| RPC cost | WebSocket subscriptions + `LISTEN/NOTIFY` instead of block polling; adaptive polling fallback | Large reduction in RPC calls and provider spend |
| Detection latency | Indexed address filtering at the provider (`eth_getLogs` with `address[]` batches) rather than full-block scans | Seconds instead of minutes at scale |
| Provider spend | Cache quotes by `(pair, amount, ttl)`; dedupe concurrent identical quote requests (single-flight) | Cuts LI.FI/Bungee calls; stays under RPM limits |
| Screening cost | Cache by address with TTL + negative caching; batch screening where the vendor supports it | Fewer billable calls |
| KMS cost/latency | Cache public key; consider KMS key caching only if AWS supports it for the key spec; never cache signatures | Lower per-tx latency |
| DB | Partition `intent_events` by month; indexes on `(status, created_at)`, `(merchant_id, status)`, `(chain_id, tx_hash)`; connection pooling tunables | Keeps the append-only table fast forever |
| Gas | Batch multi-transfer settlement per merchant; use ERC-20 paymaster so users pay fees in the token they hold | Lower merchant gas, better UX |
| Webhooks | Per-merchant concurrency limits, jittered exponential backoff, circuit-break failing endpoints | Protects the gateway from a slow merchant |
| Reconciliation | Incremental cursor-based reconciliation instead of full-range scans | Bounded runtime as volume grows |
| Idempotency | Unique index + `ON CONFLICT DO NOTHING` instead of read-then-write | Removes race conditions and lock contention |

---

## 11. Definition of done per workstream

| Workstream | DoD |
|---|---|
| WS1 | Deposit → confirmed works on testnet; no `setTimeout` retries; restart-safe; integration test in CI |
| WS2 | KMS signing for all three families; nonce collisions impossible under concurrency test; two-phase settlement; pause flag; wallet alerts + sweeps |
| WS3 | No mock provider reachable in production; screening fails closed; oracle failover; real paymaster/relayer; USD valuation non-zero |
| WS4 | CI fully green incl. docker matrix; ≥80% coverage on money path; `/metrics` + alerts live; blue-green + tested rollback; tested DB restore |
| WS5 | E2E green on testnet for 3 chains; chaos suite passes; load test meets SLOs; idempotency suite passes |
| WS6 | Contracts audited + bounty live; 5 missing docs written; dashboard on live APIs; launch checklist signed |

---

## 12. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Compliance vendor procurement delays G1 | High | High | Start day 1; interim: local OFAC/EU/UN lists + fail-closed; do not ship "fake screening" |
| 2 | Mock providers leak into production wiring | Medium | Critical | CI grep gate + explicit `providers/index.ts` factory that throws if `mock-*` is requested outside test |
| 3 | Nonce collision causes dropped/duplicate tx | Medium | Critical | DB-backed allocator, concurrency tests, startup reconciliation, RBF policy |
| 4 | KMS DER→raw signature conversion bug produces invalid sigs | Medium | High | Startup pubkey-recovery self-test; low-S normalization; per-chain tx validation before submit |
| 5 | `ScreeningUnavailableError` fail-closed causes payment outages | Medium | Medium | Manual-review queue + alerting + local sanctions fallback; make the state visible to merchants |
| 6 | Cross-chain testnet liquidity too thin for real route execution | High | Medium | Plan single-chain testnet E2E; validate cross-chain routing against recorded/live quotes, execute mainnet-capped later |
| 7 | Audit scheduling pushes mainnet | Medium | High | Engage auditors in Sprint 0; freeze contract scope early |
| 8 | In-repo K8s manifests imply capability that does not exist | High | Medium | Reconcile manifests to actual processes in Sprint 0; treat per-service split as an opt-in scale-out |
| 9 | Postgres as job queue becomes a bottleneck | Low | Medium | Job table indexed and partitioned; documented migration path to Redis/BullMQ (ADR-002) |
| 10 | Reorg finalizes a payment that later vanishes | Medium | High | Per-chain confirmation depth + finality policy, reorg detection, recovery service path |
| 11 | Scope creep into per-service deployment across 13 packages | Medium | Medium | ADR-001 decision: single worker process until measured need |
| 12 | Secrets in git / logs | Medium | Critical | ES Operator, gitleaks gate, centralized log redaction, pre-commit hook |

---

## 13. Configuration and secrets inventory

**New env vars required by this plan**

```
# Signing (WS2)
SIGNER_PROVIDER=aws-kms|local-keystore
AWS_REGION=
AWS_KMS_KEY_ALIAS_EVM=
AWS_KMS_KEY_ALIAS_TRON=
AWS_KMS_KEY_ALIAS_SOLANA=
SIGNER_MAX_DAILY_SPEND_USD_PER_CHAIN=

# Routing (WS3.1)
LIFI_API_KEY=
BUNGEE_API_KEY=
ROUTING_QUOTE_CACHE_TTL_SECONDS=
ROUTING_POLL_INTERVAL_MS=

# Compliance (WS3.2)
CHAINALYSIS_API_KEY=          # already declared
TRM_API_KEY=                  # already declared
SCREENING_MODE=real|local-lists
SCREENING_FAIL_MODE=closed|manual-review
KYT_TIMEOUT_MS=
SANCTIONS_LIST_DIR=

# Oracles (WS3.3)
ORACLE_CHAIN=coingecko,chainlink,binance
ORACLE_MAX_AGE_SECONDS=
ORACLE_MAX_DEVIATION_BPS=

# Gas abstraction (WS3.4)
PAYMASTER_PROVIDER=pimlico|alchemy
PAYMASTER_API_KEY=
PAYMASTER_URL=
RELAYER_API_KEY=
GAS_SPONSORSHIP_DAILY_CAP_USD=

# Runtime (WS1)
WORKER_POLL_INTERVAL_MS=
WORKER_CONCURRENCY=
JOB_MAX_ATTEMPTS=
JOB_BACKOFF_BASE_MS=
CHAIN_REORG_DEPTH_DEFAULT=

# Ops (WS4)
OTEL_EXPORTER_OTLP_ENDPOINT=
METRICS_ENABLED=true
EMERGENCY_PAUSE=false
```

**Rule:** every secret comes from AWS Secrets Manager / Vault via External Secrets. `.env.example` documents *names* only, never values. Config is schema-validated at boot; missing required config crashes on start.

---

## 14. Exit criteria for mainnet (G4)

All must hold simultaneously:

1. Every simulated component in §2.2 replaced with a real implementation; no `mock-*` module reachable from a production entrypoint.
2. Screening fails closed and is backed by a local sanctions list; a sanctioned test address is blocked in E2E.
3. Settlement signing via KMS on all three chain families, with a startup self-test and per-day caps.
4. Nonce concurrency and chaos suites passing (no double-spend, no lost event, no nonce gap).
5. External audit of contracts + signing/nonce path complete; all critical findings closed; report published.
6. Bug bounty live.
7. Ops: metrics + alerts + runbooks + incident response; blue-green rollback and DB restore both rehearsed.
8. Coverage ≥80% on money-path packages; CI gates (docker matrix, Trivy, audit, gitleaks, grep gates) all green.
9. Staging soak ≥2 weeks with zero unresolved P1s; SLOs met under load test.
10. Legal/compliance sign-off, treasury/insurance policy decided, capped mainnet smoke test passed and reconciled to zero.

---

## 15. Summary: the path in one paragraph

Make the system **run** first (WS1: worker, deposit watcher, durable jobs) — nothing else is testable until a payment can be detected. Then make it **real** (WS3: genuine LI.FI/Bungee routing, fail-closed Chainalysis/TRM screening, failover price oracles, live paymaster/relayer gas) — still on testnet, no custody. Then make it **move money** (WS2: AWS KMS signing for secp256k1 and ed25519, a DB-backed nonce allocator, two-phase settlement, hot-wallet limits and sweeps) — verified end-to-end on Base Sepolia, Tron Nile, and Solana Devnet. Then make it **operable** (WS4: fixed CI and Dockerfiles, real Prometheus metrics and alerts, secrets management, blue-green, tested backups, `≥80%` coverage on the money path). Finally, make it **launchable** (WS6: audited contracts, bug bounty, the five missing docs, live dashboard, rehearsed incident response). Two things must be started on day one regardless of sequencing, because their lead time is the real schedule: the compliance vendor contracts and the external audit booking.

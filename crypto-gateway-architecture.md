# Multi-Chain Crypto Payment Gateway — Technical Architecture

## 1. Design Principles

1. **Aggregate, don't rebuild.** Bridging, DEX liquidity, and RPC infrastructure are solved problems with billions in TVL securing them. The gateway is a routing/decision/risk layer on top of existing rails, not a new bridge.
2. **Every payment is an intent, not a transaction.** The customer expresses "I want to pay $50 worth of value to merchant X" — the system decides the cheapest/safest chain path to fulfill it. This single abstraction is what enables gas abstraction, recovery, and rate-locking.
3. **Merchants never touch volatility or chain complexity.** They configure a settlement asset/chain once; everything upstream is invisible to them.
4. **Nothing is unrecoverable by default.** Wrong-chain sends, underpayment, overpayment, and stuck transactions are first-class states with automated resolution paths, not support tickets.
5. **Compliance is a pluggable layer, not an afterthought.** KYC/AML/sanctions screening sits at the intent-creation and payout boundaries so the core routing logic stays jurisdiction-agnostic.

---

## 2. High-Level System Map

```
                         ┌─────────────────────────┐
                         │   Merchant Integration    │
                         │  (API / SDK / Checkout)   │
                         └────────────┬─────────────┘
                                      │
                          ┌───────────▼────────────┐
                          │   Payment Intent Service │
                          └───────────┬────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
┌───────▼────────┐           ┌────────▼────────┐          ┌─────────▼─────────┐
│  Routing Engine │◄─────────►│ Rate Lock / Risk │          │ Deposit Address /   │
│ (path selection)│           │     Engine       │          │ Smart Wallet Layer  │
└───────┬────────┘           └────────┬────────┘          └─────────┬─────────┘
        │                             │                             │
┌───────▼────────┐           ┌────────▼────────┐          ┌─────────▼─────────┐
│ Gas Abstraction │           │ Treasury / Hedge │          │  Chain Watchers /   │
│ (Paymaster/Relay)│          │     Module       │          │  Indexers (per chain)│
└───────┬────────┘           └────────┬────────┘          └─────────┬─────────┘
        │                             │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      │
                          ┌───────────▼────────────┐
                          │   Settlement Service     │
                          │ (payout to merchant asset)│
                          └───────────┬────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
┌───────▼────────┐           ┌────────▼────────┐          ┌─────────▼─────────┐
│ Recovery Service │          │ Reconciliation & │          │  Compliance/KYC     │
│ (misdirected tx, │          │ Ledger Service    │          │  Screening Layer    │
│ under/overpay)   │          └──────────────────┘          └────────────────────┘
└──────────────────┘
```

---

## 3. Core Components

### 3.1 Payment Intent Service
The system of record for every payment attempt. An intent captures: merchant ID, invoice/order reference, target amount + settlement asset/chain, accepted source assets, quote TTL, and current state.

**State machine:**
`CREATED → QUOTED → AWAITING_PAYMENT → DETECTED → CONFIRMING → ROUTING → SETTLING → SETTLED`
with side branches to `UNDERPAID`, `OVERPAID`, `MISDIRECTED`, `EXPIRED`, `REFUNDING`, `FAILED`.

Each transition emits a webhook to the merchant. This is the spine the rest of the system hangs off — routing, recovery, and reconciliation all key off intent state, not raw chain events.

### 3.2 Routing Engine
Given an intent, decides the cheapest/fastest/safest path from (customer's actual assets) to (merchant's required settlement asset).

- Aggregates quotes from bridge/DEX-aggregator APIs (e.g., LI.FI, Socket, Across, Squid, 1inch) rather than operating custom bridge contracts.
- Scores candidate paths on: total fee (bridge + DEX + gas), estimated confirmation time, bridge security/TVL, and historical reliability.
- Re-quotes if the customer's actual payment doesn't match the original quoted path (e.g., they paid from a different chain than expected).
- Publishes a decision log per intent for auditability — this matters both for dispute resolution and for regulatory review.

### 3.3 Gas Abstraction Layer
Removes the requirement that a customer hold the native gas token of whatever chain they're paying from.

- **EVM chains with account abstraction support:** ERC-4337 paymaster sponsors the UserOperation; gas cost is deducted from the payment amount before conversion.
- **EVM chains without native AA infra, or non-EVM chains (Tron, Solana, Bitcoin L2s):** relayer/meta-transaction pattern — the gateway's relayer fronts gas, submits the transaction, and reclaims the gas cost from the received funds during settlement.
- Gas cost estimation feeds directly into the rate-lock quote shown to the customer, so there's no surprise deduction.

### 3.4 Rate Lock / Risk Engine + Treasury Module
This is what actually removes volatility exposure for merchants (conversion-at-receipt alone does not, because of confirmation lag).

- On intent creation, lock an exchange rate with a short TTL (default 2–5 min, configurable per merchant risk tolerance).
- The treasury module holds a working capital buffer (or routes through a market-maker/OTC partner) to absorb the gap between quoted rate and actual settlement rate.
- Merchant is paid the exact quoted amount regardless of what happens on-chain between quote and confirmation — the gateway absorbs (or occasionally profits from) the spread.
- Risk scoring also runs here: wallet reputation checks (sanctioned addresses, known scam/mixer association, velocity anomalies) before funds are routed to settlement.

### 3.5 Deposit Address / Smart Wallet Layer
Instead of one fixed address per chain (the root cause of most "wrong chain" losses), issue a smart-contract wallet (or MPC-based address) per intent that can:
- Accept multiple asset/chain combinations at logically the "same" address where technically feasible (e.g., same address across EVM chains via deterministic deployment).
- Auto-forward or hold received funds until the routing engine claims them.
- Include allow-lists to reject clearly wrong assets at the contract level where possible, rather than accepting-then-recovering.

### 3.6 Chain Watchers / Indexers
Per-chain listeners (or a unified indexer like a self-hosted subgraph/Goldsky/Alchemy webhook setup) that detect incoming deposits, confirmations, and reorgs, and push events into the Payment Intent state machine.

### 3.7 Settlement Service
Executes the final payout to the merchant in their configured asset/chain (crypto or, if fiat off-ramp is in scope, via a licensed payment partner). Confirms against the rate-locked amount from the Risk Engine, not the live market rate.

### 3.8 Recovery Service
Handles the failure modes competitors mostly punt to support tickets:
- **Misdirected/wrong-chain payment:** detect via chain watchers scanning known deposit-address patterns across supported chains; verify ownership via signed message or originating-address match; auto-refund minus gas, or auto-credit to the correct intent if it's a same-value/different-chain mistake.
- **Underpayment:** generate a top-up link for the exact shortfall at the original locked rate (within TTL) or a re-quoted rate (if expired).
- **Overpayment:** auto-refund the excess, or offer the customer a merchant credit/forward-apply option.
- **Stuck/low-fee transactions:** monitor mempool status; offer relayer-assisted acceleration where the chain supports it (e.g., RBF, fee bumping).

### 3.9 Reconciliation & Ledger Service
- Unified double-entry ledger mapping every on-chain event to an invoice/order ID, independent of source chain/asset.
- Computes realized gain/loss per transaction (since the rate-lock means you know exact quote-time vs settlement-time values).
- Exposes exports/native connectors to QuickBooks, Xero, NetSuite, and a raw API/webhook feed for custom ERP integration.

### 3.10 Compliance / KYC Screening Layer
- Sanctions/OFAC address screening at both deposit-detection and settlement/payout points.
- Configurable KYC thresholds per merchant (transaction-value triggers, jurisdiction rules).
- Travel Rule data handling if/when fiat off-ramp or VASP-to-VASP transfer is in scope — this is a hard legal requirement in most jurisdictions above certain thresholds, not optional.

---

## 4. Core Data Model (simplified)

**PaymentIntent**
`id, merchant_id, order_ref, target_amount, target_asset, target_chain, accepted_assets[], quoted_rate, quote_expires_at, state, created_at`

**IncomingTransaction**
`id, intent_id (nullable if unmatched), tx_hash, source_chain, source_asset, source_address, amount, detected_at, confirmed_at, confirmation_count`

**RoutePlan**
`id, intent_id, path_steps[] (chain, protocol, action), estimated_fee, estimated_time, selected_at`

**LedgerEntry**
`id, intent_id, entry_type (deposit/fee/settlement/refund/fx_gain_loss), amount, asset, chain, created_at`

**RecoveryCase**
`id, related_intent_id (nullable), case_type (misdirected/underpaid/overpaid/stuck), status, resolution_action, resolved_at`

---

## 5. Recommended v1 Chain/Asset Scope

Start narrow, prove the recovery/reconciliation UX, then expand:

- **EVM (AA-capable):** Ethereum, Base, Arbitrum, Polygon — covers the bulk of stablecoin volume and has mature ERC-4337 tooling.
- **High-volume, non-EVM:** Tron (dominant for USDT transfer volume, especially outside the US/EU) and Solana (fast, cheap, growing commerce use).
- **Settlement assets:** USDC and USDT as the default merchant payout options; native asset payout as a secondary option.

Expand to Bitcoin L2s, additional EVM L2s, and further assets only after recovery and reconciliation flows are battle-tested — these are the components most likely to have edge cases that erode trust if broken.

---

## 6. Suggested Tech Stack (starting point, not prescriptive)

| Layer | Suggestion | Why |
|---|---|---|
| Intent/API service | Node.js or Go, REST + webhooks | Fast iteration, strong ecosystem for chain SDKs |
| Routing integrations | LI.FI / Socket / Across / Squid SDKs | Avoid custom bridge risk |
| Account abstraction | ERC-4337 (Alchemy/Biconomy/Pimlico paymaster infra) | Mature, audited tooling rather than custom relayers where possible |
| Chain indexing | Alchemy/QuickNode webhooks + self-hosted fallback indexer | Redundancy against provider outages |
| Ledger/DB | Postgres with an append-only ledger table + materialized balances | Auditability, double-entry integrity |
| Treasury/hedging | Direct integration with an OTC/market-maker API or on-chain DEX aggregator for buffer rebalancing | Keeps FX risk small and quantifiable |
| Compliance screening | Chainalysis/TRM Labs/Elliptic API | Industry-standard sanctions/risk data |
| Infra | Kubernetes, multi-region, chain-watcher processes isolated per chain | Fault isolation — one chain's RPC outage shouldn't take down the platform |

---

## 7. Security Considerations

- **Custody model decision is foundational:** full custody (gateway holds funds during routing) vs. non-custodial intent-based routing (customer's wallet signs a multi-step path directly) — this single decision drives your licensing burden, insurance needs, and architecture. Full custody is simpler to build but brings money-transmitter licensing in most jurisdictions.
- **Treasury buffer is a hot-wallet risk surface** — use MPC or multi-sig with strict withdrawal limits and velocity monitoring, not a single hot key.
- **Deposit address contracts must be independently audited** before mainnet — this is the component attackers will target first.
- **Reorg handling:** settlement should never fire before the chain-appropriate confirmation depth (varies per chain — e.g., higher for Ethereum L1, lower for fast-finality chains).

---

## 8. Suggested Build Order

1. Payment Intent Service + single-chain (Base) happy-path flow, no routing yet.
2. Chain watchers + basic reconciliation ledger.
3. Rate-lock + treasury buffer (removes volatility risk — high merchant value, relatively contained scope).
4. Multi-chain routing engine (bring in LI.FI/Socket).
5. Gas abstraction (ERC-4337 paymaster).
6. Recovery service (start with underpayment/overpayment; misdirected-tx detection is the hardest and can follow).
7. Compliance screening layer (required before any real volume, not truly "last," but technically decoupled enough to parallelize with 3–6).

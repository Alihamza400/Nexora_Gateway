# ADR-005: Deposit address derivation strategy

## Status

Proposed — decide during WS6.1, before Gate G4

## Context

A payment intent needs an address to be paid into. Today that address is whatever
the merchant's configuration supplies, and `SettlementService.getSettlementAddress()`
returns the zero address for the hot wallet — so the model is incomplete at both ends.

Two constraints pull in opposite directions:

- **Detection**: the watcher must be able to attribute an incoming transfer to
  exactly one intent, including when a customer pays late or twice.
- **Key exposure**: every address the gateway can *spend from* is a key that, if
  compromised, loses funds. Fewer spendable keys is strictly safer.

## Options to evaluate

| Option | Detection | Key exposure | Notes |
|---|---|---|---|
| One shared deposit address per merchant | Weak — attribution needs amount matching and heuristics | 1 key per merchant | Fails on partial/duplicate payments |
| Deterministic per-intent address (CREATE2 factory) | Strong — address identifies the intent | Keys stay wherever they are; the factory is the only contract | Needs a factory contract and a chain that supports CREATE2 (not Tron) |
| Per-intent address derived from an extended public key | Strong | xpub on the server, no spend capability — funds swept by a separately-held key | Standard HD approach; sweep step required |
| Per-intent address derived from KMS public keys | Strong | No private key material on the server at all | Key count grows with intent count; KMS quota and cost implications |

## What the decision must resolve

1. **Non-custody vs custody.** If funds arrive at addresses the gateway cannot spend,
   settlement becomes "ask the customer or use a service that can" — the model changes
   completely. If the gateway can spend, custody (WS2) applies to every such address.
2. **Cross-chain uniformity.** CREATE2 has no Tron equivalent, so a contract-based
   scheme cannot be the only mechanism.
3. **Key rotation without breaking detection.** Old deposit addresses must remain
   watchable forever, since a customer may pay months late. Rotation must therefore
   create a new *epoch*, never retire monitoring.
4. **Address reuse and privacy.** Reusing one address across intents leaks merchant
   volume to anyone watching the chain.

## Constraints already fixed

- The wire format for deriving must be deterministic and reproducible from stored
  data alone, so a reorg or a replayed event cannot produce a different address.
- Derivation is pure: given `(intent_id, merchant_id)`, the address is a function
  with no external state, so it can be verified after the fact.

## Consequence of deciding late

Detection logic cannot be written correctly, so Gate G0's deposit-watcher work must
assume an address supplied per intent and stay agnostic about where it came from.
That is the interim position this record preserves.

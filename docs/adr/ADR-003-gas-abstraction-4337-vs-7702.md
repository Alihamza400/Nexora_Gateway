# ADR-003: ERC-4337 paymaster vs EIP-7702 for gas abstraction

## Status

Proposed — decide during WS3.4, before Gate G1

## Context

Customers frequently hold USDC or USDT but no native token, so they cannot pay gas.
`packages/shared/src/types/gas-abstraction.ts` already models four strategies per
chain (`ERC4337_PAYMASTER`, `RELAYER`, `RESOURCE_MODEL`, `PRIORITY_FEE_RELAY`), and
`packages/gas-abstraction` currently returns estimates driven by a hardcoded
`nativePriceUsd`.

The gateway's situation differs from a typical dapp's in one important way: **the
payer is usually a plain EOA controlled by the customer's wallet**, not a smart
account the gateway provisions. The customer sends a transfer from whatever wallet
they already have.

That makes the choice non-obvious:

- **ERC-4337** requires the funds to sit in a smart account, or requires the
  customer's EOA to submit a userOperation — which a stock wallet cannot do without
  the account being upgraded. It fits well when the gateway controls the account
  (e.g. a deposit address it provisions) and poorly for arbitrary customer EOAs.
- **EIP-7702** lets an EOA delegate to smart-contract code in-place, so a customer's
  existing address can gain sponsored-gas behaviour without migrating funds. It is
  the more natural fit for "customer pays from their own wallet", but it depends on
  wallet and chain support and changes the security model of the EOA.

## Decision

Not yet made. This record exists to capture the constraint so the decision is made
deliberately rather than by whichever SDK is documented first.

## What the decision must resolve

1. Which population is being served: gateway-provisioned deposit addresses, or
   arbitrary customer EOAs? If both, the strategy may need to differ per flow.
2. Does the chosen approach work on every target chain, including non-EVM? Tron's
   resource model (energy/bandwidth) and Solana's fee model need the existing
   `RELAYER` and `PRIORITY_FEE_RELAY` paths regardless, so no single mechanism
   covers everything.
3. Who pays, and what is the cap? Sponsorship is a real cost with an abuse surface;
   `GAS_SPONSORSHIP_DAILY_CAP_USD` exists for exactly this reason.
4. What is the failure mode when sponsorship is unavailable? The payment must still
   be completable (fall back to requiring native gas and telling the customer), not
   silently stuck.

## Consequences of deciding late

`packages/gas-abstraction` cannot be finished, and any UI copy that promises
"no gas needed" is unverified. This is why it is scheduled in WS3.4 rather than
deferred to launch.

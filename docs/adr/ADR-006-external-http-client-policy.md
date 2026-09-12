# ADR-006: Shared outbound HTTP client policy

## Status

Accepted — 2026-09-12 (policy); implementation in WS3

## Context

The gateway will make outbound calls to chain RPC providers, LI.FI, Bungee/Socket,
Chainalysis, TRM, CoinGecko, a paymaster, and merchant webhook URLs. Today each
adapter would be free to implement its own fetch call, which historically produces
the same six defects in every integration:

1. no timeout, so a hung vendor stalls a settlement
2. no retry, so a transient 502 fails a payment
3. unbounded retries, turning a vendor outage into a self-inflicted retry storm
4. no circuit breaker, so every request waits for a known-dead vendor
5. API keys interpolated into error messages and logged
6. no allow-list, so any caller-controlled URL becomes an SSRF vector

Two facts constrain the design:

- Kubernetes `NetworkPolicy` matches IP and port, not hostname. The network layer
  can allow egress to the internet on 443 but cannot say "only `li.quest`". The
  allow-list must therefore live in the application.
- `packages/routing-engine/src/base-route-provider.ts` already establishes the
  right shape: a template-method base class with an injected `CircuitBreaker`.

## Decision

A single shared HTTP client in `@crypto-gateway/shared` is the only way any part of
the gateway talks to the internet. It provides, non-optionally:

| Concern | Policy |
|---|---|
| Timeout | Per-request, default 10 s, overridable per adapter. Uses `AbortSignal.timeout()` |
| Retries | Max 3, exponential backoff **with full jitter**, only on 429/5xx and network errors. Never on 4xx other than 429 |
| Idempotency | Retries only for idempotent requests; unsafe methods carry an explicit override plus an idempotency key |
| `Retry-After` | Honoured when the vendor sends it, capped so a vendor cannot pin a worker forever |
| Circuit breaker | Per host and per adapter, reusing the existing `CircuitBreaker` implementation |
| Host allow-list | Explicit permit list per adapter. Any URL not on it is rejected before the request is made |
| Redirects | Disabled. A redirect is an unexpected destination, not something to follow |
| Secret redaction | Keys live in headers, never in URLs, and headers are stripped from log output |
| Correlation | `X-Request-Id` propagated outbound and recorded with the response for dispute resolution |
| Response capture | Raw vendor responses for routing and screening are persisted for audit |

## Consequences

### Positive

- One place to fix a class of bug, and one place to audit for the money path.
- The allow-list closes SSRF at the application layer, which `NetworkPolicy`
  structurally cannot.
- Consistent timeout and breaker behaviour means a vendor outage degrades one
  capability instead of exhausting the worker's request pool.

### Negative

- A shared client is a shared blast radius: a bug in it affects every integration.
  Mitigated by its own test suite, including the retry/backoff and allow-list paths.
- One more abstraction between an adapter and `fetch`. Accepted for the reasons above.

## Alternatives considered

**Let each adapter use `fetch` directly.** Rejected. This is the status quo that
produced in-process retries elsewhere in this codebase.

**A generic retry library.** Rejected. The requirement is not just retries — it is
retries *plus* an allow-list, *plus* redaction, *plus* a breaker, wired into an
audit trail. A library covers one of four and still needs a wrapper.

**Restrict egress with a service mesh or Cilium `toFQDNs`.** Rejected for now.
Cilium's DNS-aware policies would enforce host allow-listing at the network layer,
which is stronger than an application check. It requires adopting Cilium as the CNI.
Worth revisiting when the cluster's networking is standardized; the application-level
allow-list remains valuable in depth regardless.

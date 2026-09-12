# Architecture Decision Records

Decisions that shape the remaining work, recorded so the reasoning survives the
people who made it. Format follows the template in `skills/workflows/development.md`.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-worker-process-topology.md) | Single worker process composes the service libraries | Accepted |
| [ADR-002](ADR-002-durable-job-queue.md) | Postgres-backed durable job queue | Accepted |
| [ADR-003](ADR-003-gas-abstraction-4337-vs-7702.md) | ERC-4337 paymaster vs EIP-7702 for gas abstraction | Proposed (WS3.4.7) |
| [ADR-004](ADR-004-observability-exporter.md) | Metrics exporter and instrumentation approach | Proposed (WS4.3) |
| [ADR-005](ADR-005-deposit-address-derivation.md) | Deposit address derivation strategy | Proposed (WS6.1.7) |
| [ADR-006](ADR-006-external-http-client-policy.md) | Shared outbound HTTP client policy | Accepted (impl. WS3) |
| [ADR-007](ADR-007-secret-scanning.md) | Repository-level secret scanning | Accepted |

## Writing a new ADR

1. Copy the structure of an existing record.
2. Number it sequentially. Never renumber.
3. State the decision in one sentence, then the alternatives you actually rejected
   and why.
4. If it supersedes an earlier record, say so in both files rather than editing
   history.

New dependencies require an ADR — the repository is deliberately lean (`pg`,
`ethers`, `fastify`), and every addition is a supply-chain and maintenance cost.

## Related documents

- [`docs/REMAINING-IMPLEMENTATION-STRATEGY.md`](../REMAINING-IMPLEMENTATION-STRATEGY.md) — the execution plan these decisions serve
- [`docs/COMPLETE-SERVICES-ROADMAP.md`](../COMPLETE-SERVICES-ROADMAP.md) — deployment narrative
- [`IMPLEMENTATION-PLAN.md`](../../IMPLEMENTATION-PLAN.md) — phase-by-phase history

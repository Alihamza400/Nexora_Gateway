# ADR-001: Single worker process composes the service libraries

## Status

Accepted — 2026-09-12

## Context

The repository has 13 packages. Only `api-gateway` has an entrypoint and a
`start` script; `payment-intent`, `chain-abstraction`, `routing-engine`,
`rate-lock`, `settlement`, `compliance`, `recovery`, `reconciliation` and
`gas-abstraction` are libraries.

Inherited from `docs/COMPLETE-SERVICES-ROADMAP.md` and the old `k8s/` manifests
were Deployments, Services and Dockerfiles for each of those packages. None of
them had a process to run, so the manifests could never become healthy, and the CI
Docker matrix built files that did not exist.

Two questions had to be answered before any integration work could start:

1. Does each service become its own long-running process?
2. How does anything drive the intent state machine when `watchDeposits()` was
   never called by a runnable process?

## Decision

**One new package, `packages/worker`, composes every service in-process** under an
explicit composition root, and runs the background work: deposit watching,
confirmation tracking, and durable job execution.

Concretely:

- `packages/worker` is the second and final runnable process.
- Services are constructed once in `packages/worker/src/composition.ts` with
  injected dependencies. No module-level singletons, so tests can construct the
  same graph with fakes.
- Library packages keep their `build`/`typecheck` scripts only — no `start`, no
  Dockerfile, no Deployment.
- `k8s/base/kustomization.yaml` contains exactly two workloads.

## Consequences

### Positive

- The state machine can actually be driven, which unblocks every integration and
  E2E test. This was the critical path.
- One deployable unit for all background work: one rollout, one log stream, one
  place to reason about shutdown ordering.
- No distributed transaction between services that fundamentally share one
  database. The services were never truly independent — they write to the same
  Postgres instance with shared tables.
- Startup cost is one process, not nine, so local development and CI stay fast.

### Negative

- A crash in any background responsibility affects all of them until it is
  restarted. Mitigated by the durable job queue (ADR-002): a restart resumes work
  rather than losing it.
- Vertical scaling boundary: heavy reconciliation could starve deposit watching.
  Mitigated by running each responsibility on its own interval with bounded
  concurrency, and by the migration path below.
- Less isolation than one-process-per-service: a memory leak in one path affects
  the worker as a whole.

## Alternatives considered

**One process per service (as the roadmap implied).** Rejected for now. It
multiplies deployment and observability surface area by nine, adds network hops
between components that share a database, and creates a distributed-transaction
problem where none exists today. It also requires nine entrypoints, nine Docker
images and nine sets of liveness semantics before a single payment can be detected.

**Fold the worker into `api-gateway`.** Rejected. Webhook retries, deposit
watching and settlement retries are long-running and must survive gateway restarts
independently of HTTP traffic. Coupling them to request-serving would make a
gateway restart drop background work and would let background load degrade API
latency.

## Migration path to per-service processes

If a responsibility measurably needs independent scaling or isolation (e.g.
reconciliation CPU, or a separate settlement signer pool), extract it:

1. Move that service's responsibilities into its own package with an entrypoint.
2. Reuse the same manifest shape as `worker.yml`.
3. Introduce the network hop explicitly and accept the distributed-transaction
   consequences.
4. Record the extraction in a new ADR superseding this one.

The trigger must be a measurement (CPU saturation, queue lag, blast radius), not
aesthetic symmetry.

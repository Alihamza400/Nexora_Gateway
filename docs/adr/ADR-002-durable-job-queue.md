# ADR-002: Postgres-backed durable job queue

## Status

Accepted — 2026-09-12

## Context

Retries in the current code are in-process:

- `packages/settlement/src/settlement.service.ts` schedules retries with
  `setTimeout` (two call sites).
- `WebhookDeliveryService` retries in-process against a stubbed `getRetryCount()`.

Any in-process retry is lost when the process exits: a deploy, a crash, an OOM
kill, or a node drain silently drops the work. For payment settlement and webhook
delivery that is data loss, not an inconvenience — a merchant never learns about a
payment, and an intent can sit in `CONFIRMING` forever.

`scripts/check-policy.sh` enforces `no-setTimeout-in-retry-paths` and currently
carries the two settlement call sites in `scripts/policy-baseline.txt`. The
baseline may only shrink, so this work is mandatory rather than optional.

Redis is provisioned in `docker-compose.yml` and `k8s/base/redis.yml`, but **no
Redis client library is used anywhere in the codebase**, and the only existing
runtime dependency is `pg` (plus `ethers` in chain-abstraction).

## Decision

**Implement the job queue on Postgres**, using `SELECT ... FOR UPDATE SKIP LOCKED`
against a `jobs` table, with:

- `status` lifecycle: `PENDING → RUNNING → SUCCEEDED | FAILED | DEAD_LETTERED`
- delivery attempts and a durable attempt counter
- exponential backoff with jitter, stored as `run_at`
- a dead-letter state after `JOB_MAX_ATTEMPTS`, queryable and alertable
- a unique idempotency key per logical job, so enqueueing twice is a no-op
- a visibility timeout so a worker that dies mid-job has its job reclaimed

## Consequences

### Positive

- **Restart-safe**, which is the whole point: kill the worker, and pending jobs
  resume on the next start.
- No new runtime dependency. The project already depends on `pg`.
- Enqueue can participate in the *same transaction* as the state change that
  caused it. This is the decisive advantage: "transition the intent to SETTLING
  and enqueue the webhook" commits atomically, so the queue and the state machine
  can never disagree. A Redis queue cannot offer that without a dual-write problem.
- Dead letters are inspectable with SQL, and job history is in the same database as
  the audit trail.

### Negative

- Polling adds baseline load. Mitigated with `LISTEN/NOTIFY` to wake on insert plus
  a slower safety-net poll.
- Lower throughput ceiling than Redis. Postgres with `SKIP LOCKED` comfortably
  handles the target of ~1,000 quotes/minute and ~100 settlements/minute; it is the
  wrong tool for millions of events per second, which is not this workload.
- The `jobs` table becomes a hot table. Mitigated with partial indexes on
  `status`/`run_at` and scheduled archival of terminal jobs.

## Alternatives considered

**Redis + BullMQ.** Rejected for now. It is the right tool at higher throughput,
but it adds a dependency and, more importantly, cannot enlist in the Postgres
transaction that performs the state transition. That would introduce a dual-write
consistency problem in the exact code path where correctness matters most.

**`pg-boss`.** Rejected. It is Postgres-backed and would work, but it imposes its
own schema and API on the core settlement path. The queue needs to be understood
and auditable by whoever reviews the money path.

**Keep in-process retries and accept the loss.** Rejected outright: silent loss of
a settlement or webhook retry is exactly the failure mode the recovery service
exists to prevent.

## Revisit trigger

Revisit if measured queue throughput exceeds what Postgres can serve with
acceptable latency (target: p99 dequeue < 50 ms at target load), or if the `jobs`
table creates meaningful contention on the primary. At that point, move *webhook
delivery only* to Redis and keep settlement on Postgres, since settlement is the
path where transactional enqueue matters.

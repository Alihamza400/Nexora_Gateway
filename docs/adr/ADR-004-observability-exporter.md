# ADR-004: Metrics exporter and instrumentation approach

## Status

Proposed — implementation scheduled for Gate G3 (WS4.3)

## Context

`k8s/base/prometheus.yml`, `grafana.yml` and `monitoring.yml` exist, the workload
manifests carry `prometheus.io/scrape: "true"` annotations, and the Dockerfile
declares a `/health` probe — but **no service exposes `/metrics`**. The observability
stack has nothing to scrape, and `prometheus.io/path: "/metrics"` describes an
endpoint that does not exist.

Without instrumentation the following are invisible, and each is a realistic
incident: deposit watcher lag, job queue growth, job age, sanctions-screening
latency and failure rate, oracle staleness, oracle divergence between sources,
hot-wallet balance, nonce gaps, settlement failure rate, KMS throttling.

## Decision (proposed)

1. **`prom-client` for metrics**, exposed at `GET /metrics` on the api-gateway and
   worker health servers, in Prometheus text format.
2. **OpenTelemetry for traces**, with a `correlation_id` propagated from the
   gateway through the worker, every external adapter, and outbound webhooks.
3. Alerts derived from the metrics below, each with a runbook link.

### Metrics to expose

| Area | Metric |
|---|---|
| HTTP | request duration histogram, request count by route/status |
| Watcher | `watcher_last_seen_block{chain}`, `watcher_lag_seconds{chain}` |
| Queue | `job_queue_depth{queue,status}`, `job_age_seconds`, `job_attempts` |
| Compliance | `screening_latency_ms`, `screening_errors_total{provider}`, `screening_decision_total` |
| Oracle | `oracle_price_age_seconds{asset}`, `oracle_deviation_bps{asset}`, `oracle_source_errors_total` |
| Settlement | `settlement_duration_ms`, `settlement_attempts_total`, `settlement_failures_total{reason}` |
| Wallet | `hot_wallet_balance{chain,asset}`, `nonce_gap_count{chain}` |
| Signing | `kms_sign_latency_ms`, `kms_sign_errors_total{code}` |

## Consequences

### Positive

- `prom-client` is small, dependency-free and exposes exactly the pull-based format
  Prometheus already scrapes. No collector process, no sidecar.
- Traces give a single payment one end-to-end story across process boundaries,
  which is the only practical way to debug a cross-chain settlement.

### Negative

- Two instrumentation systems (metrics + traces) is more than one. Accepted
  because they answer different questions: "is it broken now" versus "why did this
  specific payment fail".
- Cardinarily discipline is required — no merchant IDs, intent IDs or addresses as
  metric labels, or the metric store becomes a PII store with unbounded cardinality.

## Alternatives considered

**OpenTelemetry metrics only (drop prom-client).** Attractive for consistency — one
SDK, one exporter, and the OTel Collector can serve `/metrics` for Prometheus to
scrape. Deferred rather than rejected: it adds a collector to operate. If traces land
first and the collector is already running, prefer OTel metrics and skip
`prom-client` entirely. This is why the status is Proposed, not Accepted.

**Structured logs only.** Rejected. Logs cannot express "queue depth is 12,000 and
growing", which is precisely the signal needed before an outage.

**Hosted APM (Datadog et al.).** Rejected for now. It is faster to stand up, but
introduces per-host cost and a vendor dependency before the stack has a single real
payment flowing through it.

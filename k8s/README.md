# Kubernetes layout

```
k8s/
├── base/                       # Workloads that actually run
│   ├── namespace.yml
│   ├── configmap.yml           # Non-secret configuration
│   ├── service-accounts.yml    # Per-workload SAs, IRSA annotation for KMS
│   ├── external-secrets.yml    # Pulls secrets from AWS Secrets Manager
│   ├── postgres.yml
│   ├── redis.yml
│   ├── api-gateway.yml         # Deployment + Service + HPA
│   ├── worker.yml              # Deployment + Service (deposit watcher, jobs)
│   ├── pdb.yml
│   ├── ingress.yml             # Public API only, TLS via cert-manager
│   ├── network-policies.yml    # Default-deny + explicit allowances
│   ├── cronjob-db-backup.yml
│   ├── prometheus.yml
│   ├── grafana.yml
│   └── monitoring.yml
├── jobs/
│   └── db-migrate.yml          # Applied explicitly, never with the base
└── overlays/
    ├── staging/
    └── production/
```

## Why only two workloads

There are 13 packages but exactly two long-running processes. `routing-engine`,
`settlement`, `compliance`, `recovery`, `reconciliation`, `rate-lock`,
`gas-abstraction`, `chain-abstraction` and `payment-intent` are **libraries** that
the worker composes in-process. Manifests for them were removed because they
implied processes that do not exist.

Splitting them into separate deployments is a deliberate, measured decision —
recorded in [ADR-001](../docs/adr/ADR-001-worker-process-topology.md). If it
happens, each becomes a `worker`-shaped manifest of its own.

## Deploying

```bash
# 1. Migrate first, and wait. The migrator takes a Postgres advisory lock, so
#    concurrent deploys cannot migrate at the same time.
kubectl delete job db-migrate -n crypto-gateway --ignore-not-found
kubectl apply -f k8s/jobs/db-migrate.yml
kubectl wait --for=condition=complete job/db-migrate -n crypto-gateway --timeout=600s

# 2. Apply the overlay.
kubectl apply -k k8s/overlays/staging

# 3. Pin the exact revision (the overlay tags are placeholders).
kubectl set image deployment/api-gateway api-gateway=$REGISTRY/crypto-gateway-api-gateway:$SHA -n crypto-gateway
kubectl set image deployment/worker worker=$REGISTRY/crypto-gateway-worker:$SHA -n crypto-gateway

# 4. Watch the rollout.
kubectl rollout status deployment/api-gateway -n crypto-gateway --timeout=300s
kubectl rollout status deployment/worker -n crypto-gateway --timeout=300s

# Rollback
kubectl rollout undo deployment/api-gateway -n crypto-gateway
kubectl rollout undo deployment/worker -n crypto-gateway
```

Preview a render without touching the cluster:

```bash
kubectl kustomize k8s/overlays/production
```

## Cluster prerequisites

`kubectl apply -k` fails loudly if any of these are missing, which is intended —
a deploy without secrets should never look successful.

| Prerequisite | Used by | Notes |
|---|---|---|
| Ingress controller (`ingress-nginx`) | `ingress.yml` | Network policies allow ingress only from the `ingress-nginx` namespace |
| cert-manager + a `ClusterIssuer` | `ingress.yml` | TLS certificates |
| External Secrets Operator + `ClusterSecretStore` | `external-secrets.yml` | Secrets from AWS Secrets Manager |
| Metrics Server | HPA | Required for CPU/memory-based scaling |
| Prometheus Operator CRDs | `monitoring.yml` | If `ServiceMonitor` resources are used |

## Known gaps (tracked, not hidden)

These are deliberate and scheduled, not oversights:

1. **`postgres`, `redis`, `prometheus`, `grafana` workloads do not yet carry a hard
   `securityContext`.** Those are third-party images with their own UID and
   filesystem requirements; hardening them without a cluster to test against would
   be a guess that breaks deploys. Tracked as WS4.2.2 for Gate G3.
2. **No `worker` HPA.** The worker watches deposits and must not double-process, so
   it is held at one replica. Scaling out requires the job queue's
   `FOR UPDATE SKIP LOCKED` semantics to be proven under load first (ADR-002).
3. **The backup CronJob does not yet upload off-cluster.** The `pg_dump` and the
   upload stub are in place; wiring S3 upload plus checksum verification, and then
   rehearsing a restore, is WS4.4.3.
4. **NetworkPolicy cannot express host allow-lists.** Outbound 443 is open to the
   internet; the host allow-list is enforced in the HTTP client (ADR-006).
5. **No `kyverno`/`Conftest` admission policy yet.** The securityContext rules are
   applied by convention in the manifests, not enforced by the cluster. Cluster-side
   enforcement is WS4.2.2.

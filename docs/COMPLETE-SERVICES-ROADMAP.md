# Complete Roadmap: Opening All Gateway Services

## Overview

This document provides a comprehensive roadmap to deploy and operate all services of the Crypto Gateway in production. Follow this step-by-step guide to go from development to a fully operational payment gateway.

---

## 📋 Table of Contents

1. [Phase 1: Infrastructure Setup](#phase-1-infrastructure-setup)
2. [Phase 2: Database & Cache](#phase-2-database--cache)
3. [Phase 3: Core Services Deployment](#phase-3-core-services-deployment)
4. [Phase 4: External Integrations](#phase-4-external-integrations)
5. [Phase 5: Security Hardening](#phase-5-security-hardening)
6. [Phase 6: Monitoring & Observability](#phase-6-monitoring--observability)
7. [Phase 7: Load Testing](#phase-7-load-testing)
8. [Phase 8: Staging Validation](#phase-8-staging-validation)
9. [Phase 9: Production Launch](#phase-9-production-launch)
10. [Phase 10: Post-Launch Operations](#phase-10-post-launch-operations)

---

## Phase 1: Infrastructure Setup

### 1.1 Cloud Provider Selection

| Provider | Recommended For | Notes |
|----------|-----------------|-------|
| AWS | Enterprise, compliance | EKS, RDS, ElastiCache |
| GCP | Startups, AI/ML | GKE, Cloud SQL, Memorystore |
| Azure | Enterprise, hybrid | AKS, Azure Database, Redis Cache |

### 1.2 Kubernetes Cluster

```bash
# AWS EKS
eksctl create cluster \
  --name crypto-gateway \
  --version 1.24 \
  --nodegroup-name workers \
  --node-type m5.xlarge \
  --nodes 3 \
  --nodes-min 3 \
  --nodes-max 10 \
  --region us-east-1

# GCP GKE
gcloud container clusters create crypto-gateway \
  --num-nodes=3 \
  --machine-type=e2-standard-4 \
  --region=us-central1

# Azure AKS
az aks create \
  --resource-group crypto-gateway-rg \
  --name crypto-gateway \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3
```

### 1.3 Domain & DNS

```bash
# Register domain
# Configure DNS records
# api.yourdomain.com → Load Balancer IP
# grafana.yourdomain.com → Monitoring LB
# prometheus.yourdomain.com → Internal only
```

### 1.4 SSL/TLS Certificates

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@domain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

---

## Phase 2: Database & Cache

### 2.1 PostgreSQL Setup

```bash
# Deploy PostgreSQL StatefulSet
kubectl apply -f k8s/postgres.yml

# Wait for readiness
kubectl rollout status statefulset/postgres -n crypto-gateway

# Create database and user
kubectl exec -it postgres-0 -n crypto-gateway -- \
  psql -U postgres -c "CREATE USER crypto_user WITH PASSWORD 'secure_password';"
  
kubectl exec -it postgres-0 -n crypto-gateway -- \
  psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE crypto_gateway TO crypto_user;"
```

### 2.2 Redis Setup

```bash
# Deploy Redis
kubectl apply -f k8s/redis.yml

# Wait for readiness
kubectl rollout status statefulset/redis -n crypto-gateway

# Verify connectivity
kubectl exec -it redis-0 -n crypto-gateway -- redis-cli ping
```

### 2.3 Database Migrations

```bash
# Run migrations
kubectl run db-migrate \
  --namespace=crypto-gateway \
  --image=crypto-gateway/db:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://crypto_user:secure_password@postgres-service:5432/crypto_gateway" \
  --command -- npm run db:migrate

# Verify tables created
kubectl exec -it postgres-0 -n crypto-gateway -- \
  psql -U crypto_user -d crypto_gateway -c "\dt"
```

### 2.4 Seed Data

```bash
# Load seed data for development/staging
kubectl run db-seed \
  --namespace=crypto-gateway \
  --image=crypto-gateway/db:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://crypto_user:secure_password@postgres-service:5432/crypto_gateway" \
  --command -- npm run db:seed
```

---

## Phase 3: Core Services Deployment

### 3.1 Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL TRAFFIC                            │
│                          ↓                                      │
│                   ┌─────────────┐                               │
│                   │   Ingress   │                               │
│                   │  Controller │                               │
│                   └─────────────┘                               │
│                          ↓                                      │
│                   ┌─────────────┐                               │
│                   │ API Gateway │ :3000                          │
│                   │  (Fastify)  │                               │
│                   └─────────────┘                               │
│                          ↓                                      │
│    ┌────────────────────────────────────────────────────┐       │
│    │                  INTERNAL SERVICES                 │       │
│    ├──────────────┬──────────────┬──────────────┬───────┤       │
│    │ Payment      │ Chain        │ Routing      │ Rate  │       │
│    │ Intent       │ Abstraction  │ Engine       │ Lock  │       │
│    │ :3001        │ :3002        │ :3003        │ :3008 │       │
│    ├──────────────┼──────────────┼──────────────┼───────┤       │
│    │ Settlement   │ Compliance   │ Recovery     │ Gas   │       │
│    │ :3004        │ :3005        │ :3006        │ :3009 │       │
│    ├──────────────┴──────────────┴──────────────┴───────┤       │
│    │              SUPPORTING SERVICES                   │       │
│    │  Reconciliation :3007  │  DB  │  Redis             │       │
│    └────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Deploy All Services

```bash
# Create secrets
kubectl apply -f k8s/secrets.yml

# Apply configurations
kubectl apply -f k8s/configmap.yml

# Deploy core services
kubectl apply -f k8s/api-gateway.yml
kubectl apply -f k8s/payment-intent.yml
kubectl apply -f k8s/chain-abstraction.yml
kubectl apply -f k8s/routing-engine.yml
kubectl apply -f k8s/rate-lock.yml
kubectl apply -f k8s/settlement.yml
kubectl apply -f k8s/compliance.yml
kubectl apply -f k8s/recovery.yml
kubectl apply -f k8s/reconciliation.yml

# Apply network policies
kubectl apply -f k8s/network-policies.yml
```

### 3.3 Verify All Services

```bash
# Check pod status
kubectl get pods -n crypto-gateway

# Expected output:
# NAME                                    READY   STATUS    RESTARTS   AGE
# api-gateway-xxxxx                       1/1     Running   0          5m
# payment-intent-xxxxx                    1/1     Running   0          5m
# chain-abstraction-xxxxx                 1/1     Running   0          5m
# routing-engine-xxxxx                    1/1     Running   0          5m
# rate-lock-xxxxx                         1/1     Running   0          5m
# settlement-xxxxx                        1/1     Running   0          5m
# compliance-xxxxx                        1/1     Running   0          5m
# recovery-xxxxx                          1/1     Running   0          5m
# reconciliation-xxxxx                    1/1     Running   0          5m
# postgres-0                              1/1     Running   0          10m
# redis-0                                 1/1     Running   0          10m

# Check services
kubectl get services -n crypto-gateway

# Check deployments
kubectl get deployments -n crypto-gateway
```

### 3.4 Service Health Checks

```bash
# API Gateway
kubectl exec -it $(kubectl get pod -l app=api-gateway -n crypto-gateway -o jsonpath='{.items[0].metadata.name}') -n crypto-gateway -- \
  curl -s http://localhost:3000/health

# Payment Intent
kubectl exec -it $(kubectl get pod -l app=payment-intent -n crypto-gateway -o jsonpath='{.items[0].metadata.name}') -n crypto-gateway -- \
  curl -s http://localhost:3001/health

# Chain Abstraction
kubectl exec -it $(kubectl get pod -l app=chain-abstraction -n crypto-gateway -o jsonpath='{.items[0].metadata.name}') -n crypto-gateway -- \
  curl -s http://localhost:3002/health
```

---

## Phase 4: External Integrations

### 4.1 Chain RPC Providers

| Chain | Provider | Cost | Rate Limit |
|-------|----------|------|------------|
| Ethereum | Infura/Alchemy | $50-200/mo | 100K-1M req/day |
| Base | Alchemy | $50/mo | 100M CU/mo |
| Arbitrum | Infura | $50/mo | 100K req/day |
| Polygon | Alchemy | $50/mo | 100M CU/mo |
| Tron | TronGrid | Free tier | 100K req/day |
| Solana | Helius/QuickNode | $50-100/mo | 100K-1M req/day |

**Setup:**

```bash
# Update secrets with RPC URLs
kubectl create secret generic crypto-gateway-secrets \
  --namespace=crypto-gateway \
  --from-literal=ETHEREUM_RPC_URL='https://mainnet.infura.io/v3/YOUR_KEY' \
  --from-literal=BASE_RPC_URL='https://base-mainnet.g.alchemy.com/v2/YOUR_KEY' \
  --from-literal=ARBITRUM_RPC_URL='https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY' \
  --from-literal=POLYGON_RPC_URL='https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY' \
  --from-literal=TRON_FULL_NODE='https://api.trongrid.io' \
  --from-literal=SOLANA_RPC_URL='https://mainnet.helius-rpc.com/?api-key=YOUR_KEY' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 4.2 Compliance APIs

| Provider | Purpose | Cost |
|----------|---------|------|
| Chainalysis | KYT, sanctions screening | $1,000-5,000/mo |
| TRM Labs | Risk scoring, compliance | $1,000-5,000/mo |

**Setup:**

```bash
kubectl create secret generic compliance-secrets \
  --namespace=crypto-gateway \
  --from-literal=CHAINALYSIS_API_KEY='your_key' \
  --from-literal=TRM_API_KEY='your_key' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 4.3 Price Oracles

| Provider | Purpose | Cost |
|----------|---------|------|
| CoinGecko | Price feeds | Free tier available |
| Chainlink | Decentralized oracles | Gas costs only |

### 4.4 Webhook Configuration

```bash
# Configure merchant webhook URLs
kubectl create secret generic webhook-secrets \
  --namespace=crypto-gateway \
  --from-literal=WEBHOOK_SECRET='your_webhook_secret' \
  --dry-run=client -o yaml | kubectl apply -f -
```

---

## Phase 5: Security Hardening

### 5.1 Secrets Management

**Production Option: HashiCorp Vault**

```bash
# Install Vault
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault --namespace vault --create-namespace

# Initialize vault
kubectl exec -it vault-0 -n vault -- vault operator init

# Store secrets
kubectl exec -it vault-0 -n vault -- vault kv put secret/crypto-gateway/database \
  url="postgresql://user:pass@postgres:5432/crypto_gateway" \
  username="crypto_user" \
  password="secure_password"
```

### 5.2 Hot Wallet Security

```bash
# Option 1: AWS KMS
aws kms create-key --description "Crypto Gateway Hot Wallet"
aws kms create-alias --alias-name alias/crypto-gateway-hot-wallet --target-key-id <key-id>

# Option 2: HashiCorp Vault Transit
kubectl exec -it vault-0 -n vault -- vault secrets enable transit
kubectl exec -it vault-0 -n vault -- vault write -f transit/keys/hot-wallet type=ecdsa-p256
```

### 5.3 Network Security

```bash
# Apply network policies
kubectl apply -f k8s/network-policies.yml

# Verify policies
kubectl get networkpolicies -n crypto-gateway
```

### 5.4 RBAC Configuration

```yaml
# rbac.yml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: crypto-gateway-role
  namespace: crypto-gateway
rules:
  - apiGroups: [""]
    resources: ["secrets", "configmaps"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: crypto-gateway-binding
  namespace: crypto-gateway
subjects:
  - kind: ServiceAccount
    name: crypto-gateway-sa
roleRef:
  kind: Role
  name: crypto-gateway-role
  apiGroup: rbac.authorization.k8s.io
```

### 5.5 Container Security

```yaml
# Add to deployment specs
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 2000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

---

## Phase 6: Monitoring & Observability

### 6.1 Deploy Prometheus

```bash
kubectl apply -f k8s/prometheus.yml
kubectl apply -f k8s/monitoring.yml
```

### 6.2 Deploy Grafana

```bash
kubectl apply -f k8s/grafana.yml

# Get Grafana password
kubectl get secret grafana-secrets -n monitoring -o jsonpath="{.data.admin-password}" | base64 -d
```

### 6.3 Key Dashboards

1. **Payment Intent Dashboard**
   - Intent creation rate
   - State transitions
   - Success/failure rates

2. **Settlement Dashboard**
   - Settlement volume
   - Settlement success rate
   - Average settlement time

3. **Recovery Dashboard**
   - Recovery cases by type
   - Resolution success rate
   - Average resolution time

4. **Infrastructure Dashboard**
   - Pod CPU/Memory usage
   - Database connections
   - Redis hit rate

### 6.4 Alert Configuration

```yaml
# alerts.yml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: crypto-gateway-alerts
  namespace: monitoring
spec:
  groups:
    - name: crypto-gateway
      rules:
        - alert: HighErrorRate
          expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High error rate detected"
            
        - alert: SettlementFailed
          expr: increase(settlement_failed_total[1h]) > 5
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Settlement failures detected"
```

---

## Phase 7: Load Testing

### 7.1 Install Artillery

```bash
npm install -g artillery
```

### 7.2 Run Load Tests

```bash
# Warm up
artillery run tests/load/load-test.yml --target http://api.yourdomain.com

# Full load test
artillery run tests/load/load-test.yml \
  --target http://api.yourdomain.com \
  --output report.json

# Generate HTML report
artillery report report.json --output report.html
```

### 7.3 Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Requests/sec | 10,000+ | - |
| P50 Latency | < 200ms | - |
| P95 Latency | < 500ms | - |
| P99 Latency | < 1000ms | - |
| Error Rate | < 0.1% | - |
| Settlement Success | > 99.9% | - |

---

## Phase 8: Staging Validation

### 8.1 Staging Environment

```bash
# Deploy to staging
kubectl apply -f k8s/ -n crypto-gateway-staging

# Run smoke tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

### 8.2 Testnet Validation

```bash
# Test on Base Sepolia
# 1. Create test intent
curl -X POST https://staging-api.yourdomain.com/api/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test_key" \
  -d '{
    "merchant_id": "test_merchant",
    "order_ref": "test_order_001",
    "target_amount": 100,
    "target_asset": "USDC",
    "target_chain": "8453",
    "accepted_assets": ["ETH", "USDC"]
  }'

# 2. Verify intent created
curl https://staging-api.yourdomain.com/api/v1/intents/{intent_id} \
  -H "X-API-Key: test_key"

# 3. Simulate deposit
# 4. Verify settlement
# 5. Check reconciliation
```

### 8.3 Merchant Onboarding Test

```bash
# Create test merchant
curl -X POST https://staging-api.yourdomain.com/api/v1/merchants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Merchant",
    "settlement_asset": "USDC",
    "settlement_chain": "8453",
    "settlement_address": "0x...",
    "accepted_chains": ["1", "8453"],
    "accepted_assets": ["ETH", "USDC"],
    "fee_percentage": 1.5,
    "webhook_url": "https://merchant.example.com/webhooks"
  }'
```

---

## Phase 9: Production Launch

### 9.1 Pre-Launch Checklist

```markdown
## Infrastructure
- [ ] Kubernetes cluster provisioned
- [ ] Database deployed and migrated
- [ ] Redis deployed and configured
- [ ] All services deployed and healthy
- [ ] Network policies applied
- [ ] Secrets configured

## Security
- [ ] SSL/TLS certificates configured
- [ ] RBAC configured
- [ ] Container security context applied
- [ ] Hot wallet key management configured
- [ ] API keys rotated

## Monitoring
- [ ] Prometheus deployed
- [ ] Grafana dashboards configured
- [ ] Alert rules configured
- [ ] PagerDuty/Opsgenie integration

## Testing
- [ ] Unit tests passing (494/494)
- [ ] Integration tests passing
- [ ] Load tests completed
- [ ] Security scan passed

## Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Merchant integration guide
- [ ] Operations runbook
- [ ] Incident response plan
```

### 9.2 Deployment Commands

```bash
# 1. Apply all resources
kubectl apply -f k8s/

# 2. Verify all pods running
kubectl get pods -n crypto-gateway

# 3. Check all services healthy
kubectl exec -it $(kubectl get pod -l app=api-gateway -n crypto-gateway -o jsonpath='{.items[0].metadata.name}') -n crypto-gateway -- \
  curl -s http://localhost:3000/health/ready

# 4. Enable ingress
kubectl apply -f k8s/ingress.yml

# 5. Verify external access
curl https://api.yourdomain.com/health
```

### 9.3 Go-Live Steps

1. **Announce maintenance window**
2. **Deploy to production**
3. **Verify all services healthy**
4. **Enable traffic**
5. **Monitor for 1 hour**
6. **Announce launch**

---

## Phase 10: Post-Launch Operations

### 10.1 Daily Operations

```bash
# Morning health check
kubectl get pods -n crypto-gateway
kubectl top pods -n crypto-gateway

# Check for alerts
kubectl get prometheusrules -n monitoring

# Review logs
kubectl logs -l app=api-gateway -n crypto-gateway --tail=100
```

### 10.2 Weekly Operations

```bash
# Database backup
kubectl exec -it postgres-0 -n crypto-gateway -- \
  pg_dump -U crypto_user crypto_gateway > backup_$(date +%Y%m%d).sql

# Review metrics
# Check Grafana dashboards
# Review error rates
# Analyze performance trends
```

### 10.3 Monthly Operations

```bash
# Security audit
npm audit
trivy image crypto-gateway/api-gateway:latest

# Performance review
# Review load test results
# Optimize slow queries
# Review and update dependencies

# Capacity planning
# Review resource usage
# Scale if needed
```

### 10.4 Incident Response

```bash
# 1. Detect issue
kubectl get pods -n crypto-gateway | grep -v Running

# 2. Investigate
kubectl describe pod <pod-name> -n crypto-gateway
kubectl logs <pod-name> -n crypto-gateway

# 3. Mitigate
kubectl rollout restart deployment/<service> -n crypto-gateway

# 4. Escalate if needed
# Contact on-call engineer
# Page incident response team

# 5. Post-mortem
# Document incident
# Create action items
# Update runbook
```

---

## 📊 Service Status Summary

| Service | Port | Replicas | Status |
|---------|------|----------|--------|
| API Gateway | 3000 | 3 | ✅ Ready |
| Payment Intent | 3001 | 2 | ✅ Ready |
| Chain Abstraction | 3002 | 2 | ✅ Ready |
| Routing Engine | 3003 | 2 | ✅ Ready |
| Settlement | 3004 | 2 | ✅ Ready |
| Compliance | 3005 | 2 | ✅ Ready |
| Recovery | 3006 | 2 | ✅ Ready |
| Reconciliation | 3007 | 1 | ✅ Ready |
| Rate Lock | 3008 | 2 | ✅ Ready |
| Gas Abstraction | 3009 | 1 | ✅ Ready |
| PostgreSQL | 5432 | 1 | ✅ Ready |
| Redis | 6379 | 1 | ✅ Ready |

---

## 🚀 Quick Start Commands

```bash
# 1. Clone repository
git clone https://github.com/your-org/crypto-gateway.git
cd crypto-gateway

# 2. Install dependencies
npm install

# 3. Start local environment
docker-compose up -d

# 4. Run migrations
npm run db:migrate

# 5. Start services
npm run dev

# 6. Run tests
npm test

# 7. Build for production
npm run build

# 8. Deploy to Kubernetes
kubectl apply -f k8s/
```

---

## 📚 Additional Resources

- [API Documentation](./API-DOCUMENTATION.md)
- [Merchant Integration Guide](./MERCHANT-GUIDE.md)
- [Operations Runbook](./OPERATIONS-RUNBOOK.md)
- [Incident Response Plan](./INCIDENT-RESPONSE.md)
- [Security Policy](./SECURITY-POLICY.md)

---

**Last Updated:** August 13, 2026  
**Version:** 1.0.0

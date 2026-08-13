# Production Deployment Guide

## Overview

This document provides instructions for deploying the Crypto Gateway to production environments.

## Prerequisites

### Infrastructure Requirements

- **Kubernetes Cluster**: v1.24+ with at least 3 nodes
- **Node Resources**: Each node should have at least 4 CPU cores and 8GB RAM
- **Storage**: 50GB+ persistent storage for PostgreSQL and Redis
- **Networking**: Load balancer for external access

### Required Tools

- `kubectl` v1.24+
- `docker` v20.10+
- `helm` v3.0+ (optional, for chart management)
- Access to container registry (Docker Hub, ECR, GCR)

## Deployment Steps

### 1. Prepare Secrets

Before deploying, create the required secrets:

```bash
# Create namespace
kubectl apply -f k8s/namespace.yml

# Create secrets with actual values
kubectl create secret generic crypto-gateway-secrets \
  --namespace=crypto-gateway \
  --from-literal=DATABASE_URL='postgresql://user:password@postgres-service:5432/crypto_gateway' \
  --from-literal=REDIS_URL='redis://redis-service:6379' \
  --from-literal=ETHEREUM_RPC_URL='https://mainnet.infura.io/v3/YOUR_KEY' \
  --from-literal=BASE_RPC_URL='https://mainnet.base.org' \
  --from-literal=ARBITRUM_RPC_URL='https://arb1.arbitrum.io/rpc' \
  --from-literal=POLYGON_RPC_URL='https://polygon-rpc.com' \
  --from-literal=TRON_FULL_NODE='https://api.trongrid.io' \
  --from-literal=SOLANA_RPC_URL='https://api.mainnet-beta.solana.com' \
  --from-literal=CHAINALYSIS_API_KEY='YOUR_KEY' \
  --from-literal=TRM_API_KEY='YOUR_KEY' \
  --from-literal=WEBHOOK_SECRET='YOUR_SECRET' \
  --from-literal=HOT_WALLET_PRIVATE_KEY='YOUR_KEY'
```

### 2. Deploy Database and Cache

```bash
# Deploy PostgreSQL
kubectl apply -f k8s/postgres.yml

# Deploy Redis
kubectl apply -f k8s/redis.yml

# Wait for readiness
kubectl rollout status statefulset/postgres -n crypto-gateway
kubectl rollout status statefulset/redis -n crypto-gateway
```

### 3. Run Database Migrations

```bash
# Create a job to run migrations
kubectl run db-migrate \
  --namespace=crypto-gateway \
  --image=crypto-gateway/db:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://user:password@postgres-service:5432/crypto_gateway" \
  --command -- npm run db:migrate

# Wait for completion
kubectl wait --for=condition=ready pod/db-migrate -n crypto-gateway --timeout=120s
```

### 4. Deploy Services

```bash
# Apply all service deployments
kubectl apply -f k8s/api-gateway.yml
kubectl apply -f k8s/payment-intent.yml
kubectl apply -f k8s/chain-abstraction.yml
kubectl apply -f k8s/routing-engine.yml
kubectl apply -f k8s/settlement.yml
kubectl apply -f k8s/compliance.yml
kubectl apply -f k8s/recovery.yml
kubectl apply -f k8s/reconciliation.yml

# Apply network policies
kubectl apply -f k8s/network-policies.yml
```

### 5. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n crypto-gateway

# Check services
kubectl get services -n crypto-gateway

# Check deployments
kubectl get deployments -n crypto-gateway

# Check HPA
kubectl get hpa -n crypto-gateway
```

### 6. Deploy Monitoring

```bash
# Create monitoring namespace
kubectl create namespace monitoring

# Deploy Prometheus
kubectl apply -f k8s/prometheus.yml

# Deploy Grafana
kubectl apply -f k8s/grafana.yml

# Apply monitoring configuration
kubectl apply -f k8s/monitoring.yml
```

### 7. Configure Ingress (Optional)

Create an Ingress resource for external access:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-gateway-ingress
  namespace: crypto-gateway
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.yourdomain.com
      secretName: api-gateway-tls
  rules:
    - host: api.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-gateway-service
                port:
                  number: 80
```

## Monitoring and Alerting

### Grafana Dashboards

Access Grafana at `http://<LOAD_BALANCER_IP>:3001`:

- **Username**: admin
- **Password**: (from grafana-secrets)

### Key Metrics to Monitor

1. **Payment Intent Throughput**
   - Created vs Settled intents
   - Success rate

2. **Settlement Metrics**
   - Success/failure rates
   - Average settlement time
   - Gas costs

3. **Recovery Metrics**
   - Recovery cases by type
   - Resolution success rate

4. **Provider Metrics**
   - Provider uptime
   - Response latency
   - Error rates

### Alert Rules

The following alerts are configured in Prometheus:

- **HighErrorRate**: Error rate > 5% for 5 minutes
- **HighLatency**: P95 latency > 2 seconds
- **PodCrashLooping**: Pod restarts
- **HighMemoryUsage**: Memory > 80% of limit
- **HighCPUUsage**: CPU > 80% of limit
- **SettlementFailed**: > 5 failures per hour
- **RecoveryCasesSpike**: > 10 cases per hour

## Scaling

### Horizontal Scaling

The API Gateway has HorizontalPodAutoscaler configured:

```bash
# Check HPA status
kubectl get hpa -n crypto-gateway

# Manually scale if needed
kubectl scale deployment/api-gateway --replicas=5 -n crypto-gateway
```

### Vertical Scaling

To increase resource limits:

```bash
kubectl patch deployment api-gateway -n crypto-gateway \
  -p='{"spec":{"template":{"spec":{"containers":[{"name":"api-gateway","resources":{"limits":{"memory":"1Gi","cpu":"1000m"}}}]}}}}'
```

## Backup and Recovery

### Database Backup

```bash
# Create backup
kubectl exec -it postgres-0 -n crypto-gateway -- \
  pg_dump -U postgres crypto_gateway > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
kubectl exec -it postgres-0 -n crypto-gateway -- \
  psql -U postgres crypto_gateway < backup.sql
```

### Automated Backups

Set up a CronJob for daily backups:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: crypto-gateway
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:14-alpine
              command:
                - /bin/sh
                - -c
                - |
                  PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h postgres-service -U postgres crypto_gateway | \
                  gzip > /backup/backup_$(date +%Y%m%d).sql.gz
              env:
                - name: POSTGRES_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: crypto-gateway-secrets
                      key: DATABASE_URL
              volumeMounts:
                - name: backup-storage
                  mountPath: /backup
          volumes:
            - name: backup-storage
              persistentVolumeClaim:
                claimName: backup-pvc
```

## Security Considerations

### Network Policies

Network policies are configured to restrict traffic between services:

- Only API Gateway can access external traffic
- Internal services can only communicate with PostgreSQL and Redis
- DNS resolution is allowed for all services

### Secrets Management

- All sensitive data is stored in Kubernetes Secrets
- In production, use a secrets management solution like HashiCorp Vault
- Rotate secrets regularly

### TLS/SSL

- Enable TLS for all external endpoints
- Use cert-manager for automatic certificate management
- Enforce HTTPS with HSTS headers

## Troubleshooting

### Common Issues

1. **Pods not starting**
   ```bash
   kubectl describe pod <pod-name> -n crypto-gateway
   kubectl logs <pod-name> -n crypto-gateway
   ```

2. **Service not reachable**
   ```bash
   kubectl get endpoints <service-name> -n crypto-gateway
   kubectl describe service <service-name> -n crypto-gateway
   ```

3. **Database connection issues**
   ```bash
   kubectl exec -it postgres-0 -n crypto-gateway -- psql -U postgres -d crypto_gateway
   ```

### Logs

View logs for a specific pod:

```bash
kubectl logs <pod-name> -n crypto-gateway -f
```

View logs for all pods in a deployment:

```bash
kubectl logs -l app=api-gateway -n crypto-gateway --all-containers=true -f
```

## Rollback

If a deployment fails, rollback to the previous version:

```bash
kubectl rollout undo deployment/api-gateway -n crypto-gateway
kubectl rollout undo deployment/payment-intent -n crypto-gateway
# ... repeat for other deployments
```

## Contact

For production support, contact:
- **DevOps Team**: devops@yourdomain.com
- **On-Call Engineer**: oncall@yourdomain.com

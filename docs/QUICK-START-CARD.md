# 🚀 Quick Start Card: Opening Gateway Services

## ⚡ 5-Minute Setup

```bash
# 1. Clone & Install
git clone https://github.com/your-org/crypto-gateway.git
cd crypto-gateway
npm install

# 2. Start Local Environment
docker-compose up -d

# 3. Run Database Setup
npm run db:migrate
npm run db:seed

# 4. Start Services
npm run dev

# 5. Verify
curl http://localhost:3000/health
```

---

## 🎯 Service Endpoints

| Service | Local URL | Production URL |
|---------|-----------|----------------|
| **API Gateway** | `http://localhost:3000` | `https://api.yourdomain.com` |
| Health Check | `http://localhost:3000/health` | `https://api.yourdomain.com/health` |
| Ready Check | `http://localhost:3000/health/ready` | `https://api.yourdomain.com/health/ready` |

---

## 📋 API Endpoints

### Payment Intents

```bash
# Create Intent
POST /api/v1/intents
{
  "merchant_id": "merchant_001",
  "order_ref": "order_123",
  "target_amount": 1000,
  "target_asset": "USDC",
  "target_chain": "8453",
  "accepted_assets": ["ETH", "USDC"]
}

# Get Intent
GET /api/v1/intents/{intent_id}

# Get Merchant Intents
GET /api/v1/merchants/{merchant_id}/intents
```

### Webhooks

```bash
# Webhook Events
- INTENT_CREATED
- QUOTE_GENERATED
- DEPOSIT_DETECTED
- CONFIRMATION_RECEIVED
- ROUTE_SELECTED
- SETTLEMENT_INITIATED
- SETTLEMENT_CONFIRMED
- UNDERPAYMENT_DETECTED
- OVERPAYMENT_DETECTED
- FAILED
```

---

## 🔐 Authentication

```bash
# API Key Authentication
curl -X POST https://api.yourdomain.com/api/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{...}'
```

---

## 🏗️ Infrastructure Commands

### Kubernetes

```bash
# Check all pods
kubectl get pods -n crypto-gateway

# Check services
kubectl get services -n crypto-gateway

# Check deployments
kubectl get deployments -n crypto-gateway

# View logs
kubectl logs -f deployment/api-gateway -n crypto-gateway

# Scale service
kubectl scale deployment/api-gateway --replicas=5 -n crypto-gateway

# Restart service
kubectl rollout restart deployment/api-gateway -n crypto-gateway
```

### Database

```bash
# Connect to database
kubectl exec -it postgres-0 -n crypto-gateway -- psql -U crypto_user -d crypto_gateway

# Run migrations
kubectl apply -f k8s/db-migrate.yml

# Backup database
kubectl exec -it postgres-0 -n crypto-gateway -- pg_dump -U crypto_user crypto_gateway > backup.sql
```

### Redis

```bash
# Connect to Redis
kubectl exec -it redis-0 -n crypto-gateway -- redis-cli

# Check keys
kubectl exec -it redis-0 -n crypto-gateway -- redis-cli KEYS "*"

# Flush cache (use with caution)
kubectl exec -it redis-0 -n crypto-gateway -- redis-cli FLUSHALL
```

---

## 📊 Monitoring

### Grafana Dashboard

```bash
# Get Grafana URL
kubectl get service grafana-service -n monitoring

# Get Grafana password
kubectl get secret grafana-secrets -n monitoring -o jsonpath="{.data.admin-password}" | base64 -d
```

### Prometheus Metrics

```bash
# Get Prometheus URL
kubectl get service prometheus-service -n monitoring

# Query metrics
curl http://prometheus-service:9090/api/v1/query?query=http_requests_total
```

---

## 🚨 Troubleshooting

### Pod Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n crypto-gateway

# Check logs
kubectl logs <pod-name> -n crypto-gateway --previous
```

### Service Not Responding

```bash
# Check service endpoints
kubectl get endpoints <service-name> -n crypto-gateway

# Check network policies
kubectl get networkpolicies -n crypto-gateway

# Test connectivity
kubectl exec -it <pod-name> -n crypto-gateway -- curl http://<service-name>:<port>/health
```

### Database Connection Issues

```bash
# Check database status
kubectl get pod postgres-0 -n crypto-gateway

# Test connection
kubectl exec -it postgres-0 -n crypto-gateway -- pg_isready -U crypto_user -d crypto_gateway

# Check connection pool
kubectl exec -it postgres-0 -n crypto-gateway -- psql -U crypto_user -d crypto_gateway -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## 📈 Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Requests/sec | 10,000+ | - |
| P50 Latency | < 200ms | - |
| P95 Latency | < 500ms | - |
| P99 Latency | < 1000ms | - |
| Error Rate | < 0.1% | - |
| Uptime | 99.99% | - |

---

## 🔗 Useful Links

- [Complete Roadmap](./COMPLETE-SERVICES-ROADMAP.md)
- [API Documentation](./API-DOCUMENTATION.md)
- [Merchant Guide](./MERCHANT-GUIDE.md)
- [Operations Runbook](./OPERATIONS-RUNBOOK.md)

---

**Version:** 1.0.0  
**Last Updated:** August 13, 2026

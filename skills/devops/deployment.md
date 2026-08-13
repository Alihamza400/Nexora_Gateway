# Deployment and DevOps Skill

## Purpose
This skill defines the implementation guidelines for Deployment and DevOps - the infrastructure and operational practices for running the crypto gateway in production.

## Core Responsibilities

### 1. Infrastructure Management
- Container orchestration with Kubernetes
- Multi-region deployment
- Auto-scaling and load balancing

### 2. CI/CD Pipeline
- Automated testing and deployment
- Blue-green deployments
- Rollback capabilities

### 3. Monitoring and Observability
- Application metrics
- Infrastructure metrics
- Logging and tracing

### 4. Security Operations
- Secrets management
- Access control
- Security scanning

## Infrastructure Architecture

### Kubernetes Cluster Structure
```yaml
# Namespace structure
apiVersion: v1
kind: Namespace
metadata:
  name: crypto-gateway
  labels:
    app: crypto-gateway
    env: production
---
# Deployment for payment-intent-service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-intent-service
  namespace: crypto-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-intent-service
  template:
    metadata:
      labels:
        app: payment-intent-service
    spec:
      containers:
      - name: payment-intent-service
        image: crypto-gateway/payment-intent-service:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 15
          periodSeconds: 20
---
# Service
apiVersion: v1
kind: Service
metadata:
  name: payment-intent-service
  namespace: crypto-gateway
spec:
  selector:
    app: payment-intent-service
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-intent-service-hpa
  namespace: crypto-gateway
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-intent-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Chain Watcher Deployment
```yaml
# Dedicated deployment for chain watchers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chain-watcher-ethereum
  namespace: crypto-gateway
spec:
  replicas: 2
  selector:
    matchLabels:
      app: chain-watcher
      chain: ethereum
  template:
    metadata:
      labels:
        app: chain-watcher
        chain: ethereum
    spec:
      containers:
      - name: chain-watcher
        image: crypto-gateway/chain-watcher:latest
        env:
        - name: CHAIN_ID
          value: "1"
        - name: RPC_URL
          valueFrom:
            secretKeyRef:
              name: rpc-secrets
              key: ethereum
        - name: WATCH_ADDRESSES
          valueFrom:
            configMapKeyRef:
              name: watch-addresses
              key: ethereum
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

## CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run linting
      run: npm run lint
      
    - name: Run type checking
      run: npm run typecheck
      
    - name: Run unit tests
      run: npm run test:unit
      
    - name: Run integration tests
      run: npm run test:integration
      env:
        DATABASE_URL: postgres://localhost:5432/test
        
    - name: Run security scan
      uses: aquasecurity/trivy-action@master
      with:
        scan-type: 'fs'
        scan-ref: '.'
        severity: 'CRITICAL,HIGH'

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Build Docker images
      run: |
        docker build -t crypto-gateway/payment-intent-service:${{ github.sha }} -f services/payment-intent-service/Dockerfile .
        docker build -t crypto-gateway/routing-engine:${{ github.sha }} -f services/routing-engine/Dockerfile .
        
    - name: Push to registry
      run: |
        docker push crypto-gateway/payment-intent-service:${{ github.sha }}
        docker push crypto-gateway/routing-engine:${{ github.sha }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    steps:
    - name: Deploy to staging
      run: |
        kubectl set image deployment/payment-intent-service \
          payment-intent-service=crypto-gateway/payment-intent-service:${{ github.sha }} \
          -n crypto-gateway-staging
          
  deploy-production:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
    - name: Deploy to production
      run: |
        kubectl set image deployment/payment-intent-service \
          payment-intent-service=crypto-gateway/payment-intent-service:${{ github.sha }} \
          -n crypto-gateway-production
```

### Blue-Green Deployment
```yaml
# Blue-green deployment strategy
apiVersion: v1
kind: Service
metadata:
  name: payment-intent-service
  namespace: crypto-gateway
spec:
  selector:
    app: payment-intent-service
    version: blue  # or green
  ports:
  - port: 80
    targetPort: 3000
---
# Deployment for blue version
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-intent-service-blue
  namespace: crypto-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-intent-service
      version: blue
  template:
    metadata:
      labels:
        app: payment-intent-service
        version: blue
    spec:
      containers:
      - name: payment-intent-service
        image: crypto-gateway/payment-intent-service:blue
---
# Deployment for green version
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-intent-service-green
  namespace: crypto-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-intent-service
      version: green
  template:
    metadata:
      labels:
        app: payment-intent-service
        version: green
    spec:
      containers:
      - name: payment-intent-service
        image: crypto-gateway/payment-intent-service:green
```

## Secrets Management

### HashiCorp Vault Integration
```yaml
# Vault configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: vault-config
  namespace: crypto-gateway
data:
  vault.hcl: |
    storage "consul" {
      address = "consul:8500"
      path    = "vault/"
    }
    
    listener "tcp" {
      address     = "0.0.0.0:8200"
      tls_disable = 1
    }
    
    ui = true
---
# Kubernetes auth method
apiVersion: v1
kind: Secret
metadata:
  name: vault-token
  namespace: crypto-gateway
type: Opaque
stringData:
  token: "s.xxxxx"
```

### Secrets Injection
```yaml
# Using Vault Agent Injector
apiVersion: v1
kind: Pod
metadata:
  name: payment-intent-service
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "crypto-gateway"
    vault.hashicorp.com/agent-inject-secret-db-creds: "secret/data/crypto-gateway/db"
    vault.hashicorp.com/agent-inject-template-db-creds: |
      {{- with secret "secret/data/crypto-gateway/db" -}}
      {
        "username": "{{ .Data.data.username }}",
        "password": "{{ .Data.data.password }}"
      }
      {{- end -}}
spec:
  containers:
  - name: payment-intent-service
    image: crypto-gateway/payment-intent-service:latest
```

## Monitoring and Observability

### Prometheus Configuration
```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
```

### Grafana Dashboard
```json
{
  "dashboard": {
    "title": "Crypto Gateway Overview",
    "panels": [
      {
        "title": "Payment Intents",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(payment_intents_created_total[5m])",
            "legendFormat": "Created"
          },
          {
            "expr": "rate(payment_intents_settled_total[5m])",
            "legendFormat": "Settled"
          }
        ]
      },
      {
        "title": "Settlement Success Rate",
        "type": "gauge",
        "targets": [
          {
            "expr": "sum(rate(settlements_successful_total[5m])) / sum(rate(settlements_total[5m])) * 100"
          }
        ]
      },
      {
        "title": "Recovery Cases",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(recovery_cases_created_total[5m])",
            "legendFormat": "Created"
          },
          {
            "expr": "rate(recovery_cases_resolved_total[5m])",
            "legendFormat": "Resolved"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules
```yaml
# prometheus-alerts.yml
groups:
- name: crypto-gateway-alerts
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }}% for the last 5 minutes"
      
  - alert: SettlementFailure
    expr: rate(settlements_failed_total[5m]) > 0.05
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "Settlement failures detected"
      description: "Settlement failure rate is {{ $value }}%"
      
  - alert: HighLatency
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High latency detected"
      description: "95th percentile latency is {{ $value }}s"
```

## Logging

### ELK Stack Configuration
```yaml
# elasticsearch.yml
cluster.name: crypto-gateway
network.host: 0.0.0.0
discovery.type: single-node
xpack.security.enabled: true

# kibana.yml
server.host: "0.0.0.0"
elasticsearch.hosts: ["http://elasticsearch:9200"]

# logstash.conf
input {
  beats {
    port => 5044
  }
}

filter {
  if [container_name] =~ /payment-intent-service/ {
    grok {
      match => { "message" => "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} %{GREEDYDATA:message}" }
    }
    date {
      match => [ "timestamp", "ISO8601" ]
    }
  }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "crypto-gateway-%{+YYYY.MM.dd}"
  }
}
```

## Security Operations

### Network Policies
```yaml
# Network policy for payment-intent-service
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-intent-service-network-policy
  namespace: crypto-gateway
spec:
  podSelector:
    matchLabels:
      app: payment-intent-service
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: api-gateway
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgresql
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
```

### Pod Security Standards
```yaml
# Pod security policy
apiVersion: policy/v1
kind: PodSecurityPolicy
metadata:
  name: crypto-gateway-psp
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
  - ALL
  volumes:
  - 'configMap'
  - 'emptyDir'
  - 'projected'
  - 'secret'
  - 'downwardAPI'
  - 'persistentVolumeClaim'
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: 'MustRunAsNonRoot'
  seLinux:
    rule: 'RunAsAny'
  fsGroup:
    rule: 'RunAsAny'
  supplementalGroups:
    rule: 'RunAsAny'
```

## Disaster Recovery

### Backup Strategy
```yaml
# CronJob for database backup
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
          - name: postgres-backup
            image: postgres:14
            command:
            - /bin/sh
            - -c
            - |
              pg_dump -h postgresql -U postgres crypto_gateway | \
              gzip > /backup/crypto_gateway_$(date +%Y%m%d).sql.gz
            volumeMounts:
            - name: backup-volume
              mountPath: /backup
          volumes:
          - name: backup-volume
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
```

### Recovery Procedures
```yaml
# Recovery runbook
apiVersion: v1
kind: ConfigMap
metadata:
  name: recovery-runbook
  namespace: crypto-gateway
data:
  procedures.md: |
    # Disaster Recovery Procedures
    
    ## Database Recovery
    1. Identify the point-in-time for recovery
    2. Restore from backup
    3. Apply WAL logs if needed
    4. Verify data integrity
    
    ## Service Recovery
    1. Check pod status
    2. Review logs for errors
    3. Restart failed pods if needed
    4. Verify health endpoints
    
    ## Chain Watcher Recovery
    1. Check RPC connectivity
    2. Verify block synchronization
    3. Restart watchers if needed
    4. Monitor for missed events
```

## Cost Optimization

### Resource Quotas
```yaml
# Resource quotas
apiVersion: v1
kind: ResourceQuota
metadata:
  name: crypto-gateway-quota
  namespace: crypto-gateway
spec:
  hard:
    requests.cpu: "20"
    requests.memory: "40Gi"
    limits.cpu: "40"
    limits.memory: "80Gi"
    persistentvolumeclaims: "10"
```

### Cost Monitoring
```yaml
# Kubecost configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubecost-config
  namespace: kubecost
data:
  values.yaml: |
    prometheus:
      server:
        global:
          external_labels:
            cluster_id: crypto-gateway
            
    kubecostProductConfigs:
      currencyCode: USD
      discount: 0
      foilMode: false
```

## Performance Requirements

### Deployment
- Zero-downtime deployments
- Rollback capability within 5 minutes
- Blue-green deployment support

### Scaling
- Auto-scaling based on CPU/memory
- Manual scaling via kubectl
- Cluster autoscaling

### Monitoring
- Real-time metrics dashboard
- Alerting within 1 minute
- Log retention for 90 days

### Security
- Secrets rotation every 90 days
- Security scanning in CI/CD
- Network isolation between services
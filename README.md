
# 🔗 Crypto Gateway

> **Enterprise-grade multi-chain cryptocurrency payment gateway with chain abstraction, atomic swaps, and automated settlement.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-448%20passed-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-90%25-brightgreen)]()
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()

---

## 📋 Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Our Solution](#our-solution)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [System Design](#system-design)
- [Payment Flow](#payment-flow)
- [State Machine](#state-machine)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Security](#security)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Overview

Crypto Gateway is a **production-grade, multi-chain cryptocurrency payment gateway** that enables merchants to accept crypto payments across multiple blockchains with automatic cross-chain routing and settlement.

### What We Built

A unified API that abstracts away blockchain complexity, allowing merchants to:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MERCHANT EXPERIENCE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Merchant ──► Accept payment on ANY chain ──► Settle on ANY chain │
│                                                                     │
│   • One API endpoint for all chains                                 │
│   • Automatic gas abstraction for customers                         │
│   • Built-in compliance and KYC/AML screening                       │
│   • Double-entry ledger for financial accuracy                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ❓ Problem Statement

Merchants face significant challenges accepting crypto payments:

| Challenge | Impact | Our Solution |
|-----------|--------|--------------|
| ❌ Fragmented liquidity across chains | Complex integration | Unified API |
| ❌ Different blockchain APIs | High development cost | Chain Abstraction |
| ❌ Gas fee volatility | Unpredictable economics | Gas Abstraction |
| ❌ Manual settlement processes | Operational overhead | Auto Settlement |
| ❌ Compliance requirements (KYC/AML) | Legal risk | Built-in Compliance |
| ❌ Cross-chain routing complexity | Technical debt | Smart Routing |

---

## ✅ Our Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL TRAFFIC                            │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    API GATEWAY (Fastify)                     │   │
│  │                         :3000                                │   │
│  │  ┌───────────┬───────────┬───────────┬───────────┐         │   │
│  │  │   CORS    │  Helmet   │   Rate    │  Logging  │         │   │
│  │  │  Plugin   │  Plugin   │  Limiting │  (Pino)   │         │   │
│  │  └───────────┴───────────┴───────────┴───────────┘         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    CORE SERVICES                             │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │   Payment   │  │    Chain    │  │   Routing   │         │   │
│  │  │   Intent    │  │  Abstraction│  │   Engine    │         │   │
│  │  │   Service   │  │   Service   │  │   Service   │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │  Settlement │  │  Compliance │  │   Recovery   │         │   │
│  │  │   Service   │  │   Service   │  │   Service    │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  │                                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DATA LAYER                                │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │ PostgreSQL  │  │    Redis    │  │  Monitoring  │         │   │
│  │  │  (State)    │  │  (Cache)    │  │  (Prometheus)│         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  │                                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### Multi-Chain Support

| Chain | Status | Confirmation Depth | Block Time | Native Asset |
|-------|--------|-------------------|------------|--------------|
| Ethereum (1) | ✅ Supported | 12 blocks | 12s | ETH |
| Base (8453) | ✅ Supported | 1 block | 2s | ETH |
| Arbitrum (42161) | ✅ Supported | 1 block | 0.25s | ETH |
| Polygon (137) | ✅ Supported | 128 blocks | 2s | MATIC |
| Tron | ✅ Supported | 19 blocks | 3s | TRX |
| Solana | ✅ Supported | 32 slots | 0.4s | SOL |

### Core Capabilities

| Feature | Description | Status |
|---------|-------------|--------|
| 🔗 **Chain Abstraction** | Unified interface for all chains | ✅ Implemented |
| ⛽ **Gas Abstraction** | Customers never need gas tokens | ✅ Implemented |
| 🛣️ **Smart Routing** | Lowest fee, fastest route selection | ✅ Implemented |
| 🔐 **Compliance** | Chainalysis & TRM integration | ✅ Implemented |
| 💰 **Auto Settlement** | Double-entry ledger, automatic payouts | ✅ Implemented |
| 🔄 **Recovery** | Misdirected, underpaid, overpaid handling | ✅ Implemented |
| 📊 **Reconciliation** | Financial accuracy & audit readiness | ✅ Implemented |
| 🔒 **Rate Lock** | Volatility protection for merchants | ✅ Implemented |

---

## 🏗️ Architecture

### Design Patterns

| Pattern | Implementation | Purpose |
|---------|----------------|---------|
| **State Machine** | Payment Intent lifecycle | Predictable state transitions |
| **Circuit Breaker** | Route provider calls | Fault tolerance |
| **Repository** | Data access layer | Single responsibility |
| **Strategy** | Chain clients | Polymorphic chain handling |
| **Observer** | Webhook delivery | Event-driven notifications |
| **Saga** | Settlement flow | Distributed transaction management |

### System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PAYMENT FLOW ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. INTENT CREATION                                         │   │
│  │     Merchant creates payment intent with target amount      │   │
│  │     ↓                                                       │   │
│  │  2. RATE LOCK                                               │   │
│  │     System locks exchange rate for TTL (2-5 min)            │   │
│  │     ↓                                                       │   │
│  │  3. QUOTE GENERATION                                        │   │
│  │     Customer receives deposit address + quote               │   │
│  │     ↓                                                       │   │
│  │  4. DEPOSIT DETECTION                                       │   │
│  │     System monitors blockchain for incoming payment         │   │
│  │     ↓                                                       │   │
│  │  5. COMPLIANCE SCREENING                                    │   │
│  │     Address screened via Chainalysis/TRM                    │   │
│  │     ↓                                                       │   │
│  │  6. ROUTING SELECTION                                       │   │
│  │     Optimal cross-chain route selected (LiFi/Socket)        │   │
│  │     ↓                                                       │   │
│  │  7. SETTLEMENT                                              │   │
│  │     Funds settled to merchant's wallet                      │   │
│  │     ↓                                                       │   │
│  │  8. RECONCILIATION                                          │   │
│  │     Financial accuracy verified                             │   │
│  │     ↓                                                       │   │
│  │  9. WEBHOOK NOTIFICATION                                    │   │
│  │     Merchant notified of completion                         │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Payment Intent State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE DIAGRAM                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                              ┌──────────┐                           │
│                              │ CREATED  │                           │
│                              └────┬─────┘                           │
│                                   │                                 │
│                                   ▼                                 │
│                              ┌──────────┐                           │
│                              │  QUOTED  │                           │
│                              └────┬─────┘                           │
│                                   │                                 │
│                                   ▼                                 │
│                         ┌──────────────────┐                        │
│                         │ AWAITING_PAYMENT │                        │
│                         └────────┬─────────┘                        │
│                                  │                                  │
│                    ┌─────────────┼─────────────┐                   │
│                    │             │             │                    │
│                    ▼             ▼             ▼                    │
│             ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│             │ DETECTED │  │UNDERPAID │  │OVERPAID  │              │
│             └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│                  │             │             │                      │
│                  ▼             ▼             ▼                      │
│             ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│             │CONFIRMING│  │ RECOVERY │  │ RECOVERY │              │
│             └────┬─────┘  └──────────┘  └──────────┘              │
│                  │                                                  │
│                  ▼                                                  │
│             ┌──────────┐                                           │
│             │ ROUTING  │                                           │
│             └────┬─────┘                                           │
│                  │                                                  │
│                  ▼                                                  │
│             ┌──────────┐                                           │
│             │ SETTLING │                                           │
│             └────┬─────┘                                           │
│                  │                                                  │
│        ┌─────────┼─────────┐                                       │
│        │                   │                                        │
│        ▼                   ▼                                        │
│  ┌──────────┐        ┌──────────┐                                  │
│  │ SETTLED  │        │  FAILED  │                                  │
│  └──────────┘        └──────────┘                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Docker** & Docker Compose
- **PostgreSQL** 14+ (or use Docker)
- **Redis** 7+ (or use Docker)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/crypto-gateway.git
cd crypto-gateway

# 2. Install dependencies
npm install

# 3. Start infrastructure (PostgreSQL + Redis)
docker-compose up -d

# 4. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 5. Run database migrations
npm run db:migrate

# 6. Seed test data (optional)
npm run db:seed

# 7. Start development server
npm run dev
```

### First API Call

```bash
# Register a merchant
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Store",
    "email": "merchant@example.com",
    "password": "securepass123",
    "settlement_asset": "USDC",
    "settlement_chain": "8453"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "password": "securepass123"
  }'

# Create a payment intent (using token from login response)
curl -X POST http://localhost:3000/api/v1/intents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{
    "order_ref": "ORDER-001",
    "target_amount": 100,
    "target_asset": "USDC",
    "target_chain": "8453",
    "accepted_assets": ["ETH", "USDC", "USDT"]
  }'
```

---

## 📚 API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/auth/register` | Register a new merchant |
| `POST` | `/api/v1/auth/login` | Login with email/password |
| `GET` | `/api/v1/auth/profile` | Get merchant profile |
| `POST` | `/api/v1/auth/regenerate-key` | Regenerate API key |

### Payment Intents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/intents` | Create payment intent |
| `GET` | `/api/v1/intents/:id` | Get intent by ID |
| `GET` | `/api/v1/intents` | List merchant intents |
| `POST` | `/api/v1/intents/:id/quote` | Generate quote |

### Webhooks

| Event | Description |
|-------|-------------|
| `INTENT_CREATED` | New intent created |
| `QUOTE_GENERATED` | Quote ready for customer |
| `DEPOSIT_DETECTED` | Customer payment detected |
| `CONFIRMATION_RECEIVED` | Payment confirmed on-chain |
| `ROUTE_SELECTED` | Cross-chain route selected |
| `SETTLEMENT_INITIATED` | Settlement tx submitted |
| `SETTLEMENT_CONFIRMED` | Settlement completed |
| `FAILED` | Intent failed |

### Health Checks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | API health status |
| `GET` | `/health/ready` | Readiness check (DB + Redis) |

---

## 🏢 Production Deployment

### Kubernetes Deployment

```bash
# 1. Create namespace
kubectl create namespace crypto-gateway

# 2. Deploy secrets
kubectl apply -f k8s/secrets.yml

# 3. Deploy infrastructure
kubectl apply -f k8s/postgres.yml
kubectl apply -f k8s/redis.yml

# 4. Deploy services
kubectl apply -f k8s/api-gateway.yml
kubectl apply -f k8s/payment-intent.yml
kubectl apply -f k8s/chain-abstraction.yml
kubectl apply -f k8s/routing-engine.yml
kubectl apply -f k8s/settlement.yml
kubectl apply -f k8s/compliance.yml
kubectl apply -f k8s/recovery.yml
kubectl apply -f k8s/reconciliation.yml

# 5. Deploy monitoring
kubectl apply -f k8s/prometheus.yml
kubectl apply -f k8s/grafana.yml

# 6. Verify deployment
kubectl get pods -n crypto-gateway
```

### Docker Deployment

```bash
# Build images (one parameterized Dockerfile serves every runnable process)
docker build -f docker/Dockerfile.service --build-arg SERVICE=api-gateway -t crypto-gateway/api-gateway .
docker build -f docker/Dockerfile.service --build-arg SERVICE=worker -t crypto-gateway/worker .

# Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

---

## 🔐 Security

### Security Features

| Feature | Description | Status |
|---------|-------------|--------|
| ✅ API Key Authentication | HMAC-based API keys | Implemented |
| ✅ JWT Tokens | Stateless authentication | Implemented |
| ✅ Rate Limiting | Configurable per-endpoint | Implemented |
| ✅ Input Validation | Schema-based validation | Implemented |
| ✅ SQL Injection Protection | Parameterized queries | Implemented |
| ✅ XSS Protection | Helmet.js headers | Implemented |
| ✅ CORS Configuration | Origin whitelisting | Implemented |
| ✅ Secrets Management | K8s Secrets / Vault | Implemented |
| ✅ Network Policies | Pod-to-pod restrictions | Implemented |
| ✅ Container Security | Non-root, read-only FS | Implemented |

### Hot Wallet Security

```bash
# Production: Use AWS KMS or HashiCorp Vault
# Never store private keys in code or environment variables

# Example: AWS KMS signing
aws kms sign \
  --key-id alias/crypto-gateway-hot-wallet \
  --message <transaction_hash> \
  --message-type RAW \
  --signing-algorithm ECDSA_SHA_256
```

---

## 🧪 Testing

### Test Suite

```bash
# Run all tests (448 tests)
npm test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage

# Run TypeScript type checking
npm run typecheck

# Run linting
npm run lint
```

### Test Coverage

| Package | Tests | Coverage |
|---------|-------|----------|
| Payment Intent | 19 | 95%+ |
| Chain Abstraction | 72 | 90%+ |
| Routing Engine | 108 | 95%+ |
| Settlement | 28 | 90%+ |
| Recovery | 30 | 85%+ |
| Compliance | 23 | 80%+ |
| Gas Abstraction | 22 | 90%+ |
| Rate Lock | 47 | 90%+ |
| Shared (Errors/Utils) | 72 | 95%+ |
| **Total** | **448** | **90%+** |

---

## 📊 Monitoring

### Dashboards

| Dashboard | Metrics | Purpose |
|-----------|---------|---------|
| **Payment Flow** | Intents created/settled, success rate | Business metrics |
| **Settlement** | Settlement volume, success rate, latency | Financial operations |
| **Recovery** | Recovery cases, resolution rate | Customer support |
| **Infrastructure** | CPU, memory, disk, network | Operations |
| **Blockchain** | Gas prices, confirmation times, fees | Chain health |

### Alert Rules

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighErrorRate | Error rate > 5% for 5min | Critical |
| HighLatency | P95 latency > 2s | Warning |
| SettlementFailed | > 5 failures/hour | Critical |
| PodCrashLooping | Pod restarts > 3 | Critical |
| HighMemoryUsage | Memory > 80% | Warning |

---

## 📁 Project Structure

```
crypto-gateway/
├── packages/
│   ├── api-gateway/          # REST API layer (Fastify)
│   ├── payment-intent/       # Payment intent service
│   ├── chain-abstraction/    # Chain client library
│   ├── routing-engine/       # Multi-provider routing
│   ├── settlement/           # Settlement + ledger
│   ├── recovery/             # Recovery service
│   ├── compliance/           # KYC/AML screening
│   ├── gas-abstraction/      # Gasless transactions
│   ├── rate-lock/            # Rate locking service
│   ├── reconciliation/       # Financial reconciliation
│   ├── db/                   # Migrations, seed data
│   └── shared/               # Shared types, errors, utils
├── k8s/                      # Kubernetes manifests
├── docker/                   # Docker configurations
├── docs/                     # Documentation
├── tests/                    # Test configurations
└── config/                   # Environment configs
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=crypto_gateway
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
HOST=0.0.0.0

# Chain RPC URLs
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
TRON_FULL_NODE=https://api.trongrid.io
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Compliance
CHAINALYSIS_API_KEY=your_key
TRM_API_KEY=your_key

# Webhooks
WEBHOOK_SECRET=your_secret
```

---

## 🤝 Contributing

### Development Workflow

```bash
# 1. Fork the repository
# 2. Create feature branch
git checkout -b feature/amazing-feature

# 3. Make changes
# 4. Run tests
npm test

# 5. Run type checking
npm run typecheck

# 6. Run linting
npm run lint

# 7. Commit changes
git commit -m "feat: add amazing feature"

# 8. Push to branch
git push origin feature/amazing-feature

# 9. Open Pull Request
```

### Code Quality

- **TypeScript**: Strict mode enabled
- **ESLint**: Configured for TypeScript
- **Prettier**: Automatic formatting
- **Husky**: Pre-commit hooks
- **Vitest**: Unit testing

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [LiFi](https://li.fi/) - Cross-chain routing
- [Socket](https://socket.tech/) - Bridge aggregation
- [Chainalysis](https://www.chainalysis.com/) - Compliance APIs
- [TRM Labs](https://www.trmlabs.com/) - Risk scoring
- [Alchemy](https://www.alchemy.com/) - Blockchain infrastructure
- [Fastify](https://www.fastify.io/) - HTTP framework
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Redis](https://redis.io/) - Caching

---

## 📞 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/crypto-gateway/issues)
- **Email**: support@yourdomain.com

---

**Built with ❤️ for the crypto community**

*Last Updated: August 13, 2026*
*Version: 1.0.0*

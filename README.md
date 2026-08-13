# 🔗 Crypto Gateway

> **Multi-chain crypto payment gateway with chain abstraction, atomic swaps, and automated settlement.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-494%20passed-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-90%25-brightgreen)]()

---

## 🚀 What is Crypto Gateway?

A **production-grade, multi-chain cryptocurrency payment gateway** that enables merchants to accept crypto payments across multiple blockchains with automatic cross-chain routing and settlement.

### The Problem

Merchants face significant challenges accepting crypto payments:
- ❌ Fragmented liquidity across multiple chains
- ❌ Complex integration with different blockchain APIs
- ❌ Gas fee volatility affecting payment economics
- ❌ Manual settlement processes
- ❌ Compliance requirements (KYC/AML)

### Our Solution

Crypto Gateway provides a **unified API** that abstracts away blockchain complexity:

```
Merchant ──► Accepts payment on ANY chain ──► Settles on ANY chain ──► Receives funds
```

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔗 **Multi-Chain** | Ethereum, Base, Arbitrum, Polygon, Tron, Solana |
| ⛓️ **Chain Abstraction** | Accept on any chain, settle on any chain |
| ⛽ **Gas Abstraction** | Customers never need gas tokens |
| 🛣️ **Smart Routing** | Lowest fee, fastest route selection |
| 🔐 **Compliance** | Chainalysis & TRM integration |
| 💰 **Auto Settlement** | Double-entry ledger, automatic payouts |
| 🔄 **Recovery** | Misdirected, underpaid, overpaid handling |
| 📊 **Reconciliation** | Financial accuracy & audit readiness |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway (Fastify)                    │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Payment Intent  │ │ Chain Abstraction│ │ Routing Engine  │
│    Service      │ │    Service       │ │    Service      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Settlement    │ │   Compliance    │ │    Recovery     │
│    Service      │ │    Service      │ │    Service      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL  │  Redis  │  Monitoring            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 14 (or use Docker)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/crypto-gateway.git
cd crypto-gateway

# Install dependencies
npm install

# Start PostgreSQL and Redis
docker-compose up -d

# Run database migrations
npm run db:migrate

# Seed test data
npm run db:seed

# Start development server
npm run dev
```

### First API Call

```bash
# Create a payment intent
curl -X POST http://localhost:3000/api/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test_api_key" \
  -d '{
    "merchant_id": "merchant_001",
    "order_ref": "order_123",
    "target_amount": 1000,
    "target_asset": "USDC",
    "target_chain": "8453",
    "accepted_assets": ["ETH", "USDC", "USDT"]
  }'
```

---

## 📚 API Reference

### Payment Intents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/intents` | Create payment intent |
| `GET` | `/api/v1/intents/:id` | Get intent details |
| `GET` | `/api/v1/merchants/:id/intents` | List merchant intents |

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

---

## 🧪 Testing

```bash
# Run all tests (494 tests)
npm test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage
```

### Test Coverage

| Package | Coverage |
|---------|----------|
| Routing Engine | 95%+ |
| Chain Abstraction | 90%+ |
| Recovery | 81%+ |
| Compliance | 79%+ |
| Settlement | 90%+ |

---

## 🏢 Production Deployment

### Kubernetes

```bash
# Deploy all services
kubectl apply -f k8s/

# Check status
kubectl get pods -n crypto-gateway
```

### Docker

```bash
# Build and run
docker-compose -f docker/docker-compose.prod.yml up -d
```

---

## 🔐 Security

- ✅ API Key Authentication
- ✅ Webhook Signature Verification
- ✅ Rate Limiting
- ✅ Input Validation
- ✅ SQL Injection Protection
- ✅ Secrets Management (K8s/Vault)
- ✅ Network Policies
- ✅ Container Security (non-root)

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Complete Roadmap](docs/COMPLETE-SERVICES-ROADMAP.md) | Full deployment guide |
| [Architecture Diagrams](docs/ARCHITECTURE-DIAGRAM.md) | Visual architecture |
| [Quick Start Card](docs/QUICK-START-CARD.md) | Quick reference |
| [GitHub Description](docs/GITHUB-DESCRIPTION.md) | Repo description |

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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

---

**Built with ❤️ for the crypto community**

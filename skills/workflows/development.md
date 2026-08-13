# Development Workflow Skill

## Purpose
This skill defines the implementation guidelines for Development Workflow - the practices and processes for efficient, collaborative, and high-quality software development.

## Core Responsibilities

### 1. Git Workflow
- Branch strategy
- Commit conventions
- Pull request process

### 2. Code Standards
- TypeScript/JavaScript guidelines
- Naming conventions
- Documentation standards

### 3. Collaboration
- Code review process
- Knowledge sharing
- Pair programming

## Git Workflow

### Branch Strategy
```bash
# Main branches
main          # Production-ready code
develop       # Integration branch for features

# Supporting branches
feature/*     # New features
bugfix/*      # Bug fixes
hotfix/*      # Critical production fixes
release/*     # Release preparation

# Branch naming convention
feature/payment-intent-service
bugfix/quote-expiry-handling
hotfix/settlement-timeout
release/v1.0.0
```

### Commit Conventions
```bash
# Commit message format
<type>(<scope>): <subject>

<body>

<footer>

# Examples
feat(routing): add support for LI.FI provider

- Implement LI.FI API integration
- Add quote aggregation logic
- Include error handling and retries

Closes #123

fix(settlement): handle timeout during transaction submission

- Add retry logic with exponential backoff
- Implement circuit breaker pattern
- Add comprehensive error logging

Fixes #456

docs(api): update payment intent API documentation

- Add new endpoint documentation
- Include request/response examples
- Update error codes

# Types
feat:     New feature
fix:      Bug fix
docs:     Documentation changes
style:    Code style changes (formatting, etc.)
refactor: Code refactoring
test:     Adding tests
chore:    Maintenance tasks
perf:     Performance improvements
ci:       CI/CD changes
build:    Build system changes
```

### Pull Request Process
```markdown
# Pull Request Template

## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
- [ ] Tests pass locally
- [ ] Coverage requirements met

## Screenshots (if applicable)
[Add screenshots here]

## Related Issues
Closes #123
```

## Code Standards

### TypeScript Guidelines
```typescript
// 1. Use explicit types for function parameters and return values
function calculateFee(amount: number, rate: number): number {
  return amount * rate;
}

// 2. Use interfaces for object shapes
interface PaymentIntent {
  id: string;
  merchant_id: string;
  target_amount: number;
  state: IntentState;
}

// 3. Use enums for constants
enum IntentState {
  CREATED = 'CREATED',
  QUOTED = 'QUOTED',
  SETTLED = 'SETTLED'
}

// 4. Use type guards for runtime type checking
function isPaymentIntent(obj: any): obj is PaymentIntent {
  return (
    typeof obj.id === 'string' &&
    typeof obj.merchant_id === 'string' &&
    typeof obj.target_amount === 'number'
  );
}

// 5. Use async/await for asynchronous operations
async function fetchIntent(id: string): Promise<PaymentIntent> {
  const response = await fetch(`/api/intents/${id}`);
  return response.json();
}

// 6. Use error handling
async function safeFetchIntent(id: string): Promise<PaymentIntent | null> {
  try {
    return await fetchIntent(id);
  } catch (error) {
    console.error('Failed to fetch intent:', error);
    return null;
  }
}
```

### Naming Conventions
```typescript
// Variables and functions: camelCase
const paymentIntent = {};
function createPaymentIntent() {}

// Classes: PascalCase
class PaymentIntentService {}

// Interfaces: PascalCase with 'I' prefix (optional)
interface IPaymentIntentRepository {}
interface PaymentIntent {}

// Enums: PascalCase
enum IntentState {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_CURRENCY = 'USD';

// Private members: underscore prefix
class PaymentIntentService {
  private _repository: IPaymentIntentRepository;
  private _cache: Cache;
}

// Boolean variables: is, has, can prefixes
const isValid = true;
const hasPermission = false;
const canEdit = true;
```

### Documentation Standards
```typescript
/**
 * Payment Intent Service
 * 
 * Manages the lifecycle of payment intents, from creation to settlement.
 * This is the system of record for all payment attempts.
 * 
 * @example
 * ```typescript
 * const service = new PaymentIntentService(repository);
 * const intent = await service.createIntent({
 *   merchant_id: 'merchant-123',
 *   target_amount: 100,
 *   target_asset: 'USDC'
 * });
 * ```
 */
class PaymentIntentService {
  /**
   * Creates a new payment intent
   * 
   * @param data - The intent creation data
   * @returns The created payment intent
   * @throws {ValidationError} If required fields are missing
   * @throws {MerchantNotFoundError} If merchant doesn't exist
   * 
   * @example
   * ```typescript
   * const intent = await service.createIntent({
   *   merchant_id: 'merchant-123',
   *   target_amount: 100,
   *   target_asset: 'USDC',
   *   target_chain: '1',
   *   accepted_assets: ['USDC', 'USDT']
   * });
   * ```
   */
  async createIntent(data: NewPaymentIntent): Promise<PaymentIntent> {
    // Implementation
  }

  /**
   * Transitions an intent to a new state
   * 
   * @param id - The intent ID
   * @param event - The state transition event
   * @returns The updated payment intent
   * @throws {IntentNotFoundError} If intent doesn't exist
   * @throws {InvalidTransitionError} If transition is not allowed
   */
  async transition(id: string, event: IntentEvent): Promise<PaymentIntent> {
    // Implementation
  }
}
```

## Project Structure

### Recommended Layout
```
crypto-gateway/
├── src/
│   ├── services/
│   │   ├── payment-intent-service/
│   │   │   ├── payment-intent.service.ts
│   │   │   ├── payment-intent.repository.ts
│   │   │   ├── payment-intent.controller.ts
│   │   │   └── payment-intent.types.ts
│   │   ├── routing-engine/
│   │   │   ├── routing-engine.service.ts
│   │   │   ├── routing-engine.providers.ts
│   │   │   └── routing-engine.types.ts
│   │   └── ...
│   ├── libs/
│   │   ├── chain-abstraction/
│   │   │   ├── evm/
│   │   │   ├── tron/
│   │   │   └── solana/
│   │   ├── shared-errors/
│   │   └── shared-webhooks/
│   ├── interfaces/
│   │   ├── iroute-provider.ts
│   │   ├── ichain-client.ts
│   │   └── irisk-scorer.ts
│   └── utils/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── api/
│   └── architecture/
├── config/
│   ├── development.yaml
│   ├── staging.yaml
│   └── production.yaml
├── scripts/
│   ├── setup.sh
│   └── deploy.sh
├── .github/
│   └── workflows/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
└── README.md
```

## Code Review Process

### Review Checklist
```markdown
# Code Review Checklist

## Functionality
- [ ] Code does what it's supposed to do
- [ ] Edge cases are handled
- [ ] Error handling is comprehensive
- [ ] Performance considerations addressed

## Code Quality
- [ ] Code follows style guidelines
- [ ] No code duplication (DRY)
- [ ] Functions are small and focused (SRP)
- [ ] Variables and functions are well-named
- [ ] No magic numbers or strings

## Testing
- [ ] Unit tests are provided
- [ ] Integration tests are provided (if applicable)
- [ ] Test coverage meets requirements
- [ ] Tests are meaningful and comprehensive

## Security
- [ ] No hardcoded secrets
- [ ] Input validation is present
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] Authentication/authorization checks

## Performance
- [ ] No N+1 queries
- [ ] Appropriate indexing
- [ ] Caching where needed
- [ ] Memory leak prevention

## Documentation
- [ ] Code is documented
- [ ] API documentation is updated
- [ ] README is updated (if needed)
- [ ] CHANGELOG is updated

## Architecture
- [ ] Follows SOLID principles
- [ ] Appropriate design patterns used
- [ ] No architectural violations
- [ ] Dependencies are appropriate
```

### Review Comments
```typescript
// Good review comments
// ❌ Bad: "This is wrong"
// ✅ Good: "This could fail if the array is empty. Consider adding a check."

// ❌ Bad: "Fix this"
// ✅ Good: "This function is doing too much. Consider splitting it into smaller functions."

// ❌ Bad: "Nice code"
// ✅ Good: "The error handling here is thorough. Good job!"

// Specific suggestions
// ❌ Bad: "Change this"
// ✅ Good: "Consider using a Map here for O(1) lookups instead of Array.find() which is O(n)"
```

## Pair Programming

### Driver-Navigator Model
```
Driver: Writes the code
Navigator: Reviews, suggests, thinks ahead

Switch roles every 25-30 minutes

Benefits:
- Real-time code review
- Knowledge sharing
- Better code quality
- Faster problem solving
```

### Remote Pair Programming
```bash
# Tools
- VS Code Live Share
- Tuple
- Pop
- CodeWithMe (JetBrains)

# Best Practices
1. Use video call with screen sharing
2. Use collaborative editor
3. Communicate clearly
4. Take breaks
5. Document decisions
```

## Knowledge Sharing

### Technical Documentation
```markdown
# Architecture Decision Record (ADR)

## Title
ADR-001: Use PostgreSQL as primary database

## Status
Accepted

## Context
We need a database that supports:
- ACID transactions
- JSON data types
- Full-text search
- High availability

## Decision
We will use PostgreSQL as our primary database.

## Consequences
### Positive
- Mature and well-supported
- Excellent JSON support
- Strong consistency

### Negative
- More complex setup than SQLite
- Requires more resources

## Alternatives Considered
- MySQL: Less JSON support
- MongoDB: No ACID transactions
```

### Tech Talks
```markdown
# Monthly Tech Talk Schedule

Week 1: Architecture Review
- Review current architecture
- Discuss improvements
- Plan upcoming changes

Week 2: Deep Dive
- Technical deep dive into specific topic
- Demo new features
- Q&A session

Week 3: Retrospective
- What went well
- What could be improved
- Action items

Week 4: Knowledge Sharing
- Team member presentations
- External resources
- Learning sessions
```

## Development Environment

### Setup Script
```bash
#!/bin/bash
# setup.sh

echo "Setting up crypto-gateway development environment..."

# Install dependencies
npm install

# Setup database
docker-compose up -d postgres redis

# Run migrations
npm run migrate

# Seed database
npm run seed

# Setup git hooks
npm run prepare

echo "Development environment ready!"
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: crypto_gateway
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/crypto_gateway
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
```

## Git Hooks

### Pre-commit Hook
```bash
#!/bin/bash
# .husky/pre-commit

echo "Running pre-commit checks..."

# Run linting
npm run lint

# Run type checking
npm run typecheck

# Run tests
npm run test:unit

echo "Pre-commit checks passed!"
```

### Commit-msg Hook
```bash
#!/bin/bash
# .husky/commit-msg

echo "Validating commit message..."

# Validate commit message format
commit_msg=$(cat "$1")
pattern="^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\(.+\))?: .{1,72}"

if ! echo "$commit_msg" | grep -qE "$pattern"; then
  echo "❌ Invalid commit message format"
  echo "Expected: <type>(<scope>): <subject>"
  echo "Example: feat(routing): add support for LI.FI provider"
  exit 1
fi

echo "✅ Commit message is valid"
```

## Performance Requirements

### Development Velocity
- Feature development: 1-2 weeks per feature
- Bug fixes: 1-3 days
- Code review: < 24 hours
- Deployment: < 1 hour

### Code Quality
- Test coverage: > 80%
- Bug escape rate: < 5%
- Code review approval: < 2 rounds

### Collaboration
- Response time: < 4 hours
- Knowledge sharing: Monthly
- Documentation: Updated weekly
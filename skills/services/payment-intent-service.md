# Payment Intent Service Skill

## Purpose
This skill defines the implementation guidelines for the Payment Intent Service - the system of record for every payment attempt in the crypto gateway.

## Core Responsibilities

### 1. Intent Lifecycle Management
- Create payment intents with merchant ID, order reference, target amount, settlement asset/chain
- Manage state transitions through the intent lifecycle
- Emit webhooks on every state transition

### 2. Quote Management
- Generate quotes with configurable TTL (default 2-5 minutes)
- Store locked rates at quote time
- Validate quote expiry before settlement

### 3. Merchant Configuration Integration
- Read merchant-specific settings (settlement asset, accepted chains, webhooks)
- Apply merchant risk tolerance to quote TTL
- Enforce merchant-specific compliance rules

## Data Model

### PaymentIntent
```typescript
interface PaymentIntent {
  id: string;
  merchant_id: string;
  order_ref: string;
  target_amount: number;
  target_asset: string;
  target_chain: string;
  accepted_assets: string[];
  quoted_rate: number;
  quote_expires_at: Date;
  state: IntentState;
  created_at: Date;
  updated_at: Date;
}

type IntentState = 
  | 'CREATED'
  | 'QUOTED'
  | 'AWAITING_PAYMENT'
  | 'DETECTED'
  | 'CONFIRMING'
  | 'ROUTING'
  | 'SETTLING'
  | 'SETTLED'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'MISDIRECTED'
  | 'EXPIRED'
  | 'REFUNDING'
  | 'FAILED';
```

### IntentEvent
```typescript
interface IntentEvent {
  type: EventType;
  payload: any;
  timestamp: Date;
}

type EventType = 
  | 'INTENT_CREATED'
  | 'QUOTE_GENERATED'
  | 'QUOTE_EXPIRED'
  | 'DEPOSIT_DETECTED'
  | 'CONFIRMATION_RECEIVED'
  | 'ROUTE_SELECTED'
  | 'SETTLEMENT_INITIATED'
  | 'SETTLEMENT_CONFIRMED'
  | 'UNDERPAYMENT_DETECTED'
  | 'OVERPAYMENT_DETECTED'
  | 'MISDIRECTED_PAYMENT'
  | 'REFUND_INITIATED'
  | 'REFUND_CONFIRMED'
  | 'FAILED';
```

## State Machine Implementation

### Valid Transitions
```typescript
const VALID_TRANSITIONS: Record<IntentState, IntentState[]> = {
  CREATED: ['QUOTED', 'EXPIRED', 'FAILED'],
  QUOTED: ['AWAITING_PAYMENT', 'EXPIRED', 'FAILED'],
  AWAITING_PAYMENT: ['DETECTED', 'EXPIRED', 'FAILED'],
  DETECTED: ['CONFIRMING', 'UNDERPAID', 'OVERPAID', 'MISDIRECTED'],
  CONFIRMING: ['ROUTING', 'FAILED'],
  ROUTING: ['SETTLING', 'FAILED'],
  SETTLING: ['SETTLED', 'FAILED'],
  SETTLED: [],
  UNDERPAID: ['AWAITING_PAYMENT', 'REFUNDING', 'FAILED'],
  OVERPAID: ['SETTLING', 'REFUNDING', 'FAILED'],
  MISDIRECTED: ['REFUNDING', 'FAILED'],
  EXPIRED: [],
  REFUNDING: ['SETTLED', 'FAILED'],
  FAILED: []
};
```

### Transition Rules
```typescript
function validateTransition(current: IntentState, next: IntentState): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}
```

## Repository Pattern

### IPaymentIntentRepository
```typescript
interface IPaymentIntentRepository {
  create(intent: NewPaymentIntent): Promise<PaymentIntent>;
  transition(id: string, event: IntentEvent): Promise<PaymentIntent>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByMerchantId(merchantId: string): Promise<PaymentIntent[]>;
  findByOrderRef(orderRef: string): Promise<PaymentIntent | null>;
  findExpiredIntents(): Promise<PaymentIntent[]>;
}
```

### Implementation Guidelines
1. **Single Writer Principle** - Only repository can write to intents table
2. **Event Sourcing** - Every transition emits an event
3. **Optimistic Locking** - Use version field to prevent concurrent modifications
4. **Audit Trail** - Complete history of all transitions

## Webhook Delivery

### Webhook Payload
```typescript
interface WebhookPayload {
  intent_id: string;
  event_type: EventType;
  state: IntentState;
  timestamp: Date;
  data: any;
  signature: string;
}
```

### Delivery Requirements
1. **Idempotency** - Use intent_id + event_type as idempotency key
2. **Retry Logic** - Exponential backoff with max 5 retries
3. **Timeout** - 30 second timeout per delivery attempt
4. **Logging** - Log all delivery attempts and responses

### Retry Strategy
```
Attempt 1: Immediate
Attempt 2: 1 second delay
Attempt 3: 5 seconds delay
Attempt 4: 30 seconds delay
Attempt 5: 5 minutes delay
```

## API Design

### Create Intent
```typescript
POST /api/v1/intents
{
  "merchant_id": "string",
  "order_ref": "string",
  "target_amount": number,
  "target_asset": "string",
  "target_chain": "string",
  "accepted_assets": ["string"]
}
```

### Response
```typescript
{
  "intent_id": "string",
  "quote": {
    "rate": number,
    "expires_at": "ISO8601",
    "deposit_address": "string",
    "deposit_asset": "string",
    "deposit_chain": "string"
  },
  "state": "CREATED"
}
```

### Get Intent Status
```typescript
GET /api/v1/intents/:id
```

### Response
```typescript
{
  "intent_id": "string",
  "state": IntentState,
  "events": IntentEvent[],
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

## Error Handling

### Error Types
```typescript
enum IntentError {
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  MERCHANT_NOT_FOUND = 'MERCHANT_NOT_FOUND',
  INVALID_ASSET = 'INVALID_ASSET',
  INVALID_CHAIN = 'INVALID_CHAIN',
  AMOUNT_TOO_LOW = 'AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH = 'AMOUNT_TOO_HIGH'
}
```

### Error Response
```typescript
{
  "error": {
    "code": IntentError,
    "message": "string",
    "details": any
  }
}
```

## Testing Strategy

### Unit Tests
1. State transition validation
2. Quote generation and expiry
3. Webhook payload signing
4. Error handling

### Integration Tests
1. Full intent lifecycle
2. Webhook delivery
3. Concurrent transition handling
4. Expired intent cleanup

### Load Tests
1. Concurrent intent creation
2. High-volume webhook delivery
3. Database performance under load

## Performance Requirements

### Latency
- Intent creation: < 100ms
- Status query: < 50ms
- Webhook delivery: < 500ms

### Throughput
- 10,000+ intents per minute
- 100,000+ status queries per minute

### Availability
- 99.99% uptime
- Graceful degradation on dependency failures

## Security Considerations

### Authentication
- Merchant API key authentication
- JWT tokens for internal services
- HMAC signatures for webhooks

### Authorization
- Merchant can only access own intents
- Internal services have role-based access
- Admin access requires additional verification

### Data Protection
- Encrypt sensitive fields at rest
- Use TLS for all communications
- Audit all access to payment data
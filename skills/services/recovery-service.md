# Recovery Service Skill

## Purpose
This skill defines the implementation guidelines for the Recovery Service - the component responsible for handling failure modes like wrong-chain sends, underpayment, overpayment, and stuck transactions.

## Core Responsibilities

### 1. Wrong-Chain Detection
- Detect payments sent to wrong chains
- Verify ownership via signed messages
- Auto-refund or auto-credit

### 2. Underpayment Handling
- Generate top-up links for shortfalls
- Offer re-quoted rates
- Handle partial payments

### 3. Overpayment Handling
- Auto-refund excess
- Offer merchant credit/forward-apply
- Track overpayment cases

### 4. Stuck Transaction Recovery
- Monitor mempool status
- Offer relayer-assisted acceleration
- Handle RBF/fee bumping

## Data Model

### RecoveryCase
```typescript
interface RecoveryCase {
  id: string;
  related_intent_id: string | null;
  case_type: RecoveryCaseType;
  status: RecoveryStatus;
  customer_address: string;
  customer_chain: string;
  intended_chain: string;
  asset: string;
  amount: number;
  tx_hash: string | null;
  resolution_action: ResolutionAction | null;
  resolution_tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

enum RecoveryCaseType {
  MISDIRECTED = 'MISDIRECTED',
  UNDERPAID = 'UNDERPAID',
  OVERPAID = 'OVERPAID',
  STUCK = 'STUCK'
}

enum RecoveryStatus {
  DETECTED = 'DETECTED',
  VERIFYING = 'VERIFYING',
  RESOLVING = 'RESOLVING',
  RESOLVED = 'RESOLVED',
  FAILED = 'FAILED'
}

enum ResolutionAction {
  AUTO_REFUND = 'AUTO_REFUND',
  AUTO_CREDIT = 'AUTO_CREDIT',
  TOP_UP_LINK = 'TOP_UP_LINK',
  RE_QUOTE = 'RE_QUOTE',
  FEE_BUMP = 'FEE_BUMP',
  RELAYER_ACCELERATION = 'RELAYER_ACCELERATION'
}
```

### TopUpLink
```typescript
interface TopUpLink {
  id: string;
  recovery_case_id: string;
  amount: number;
  asset: string;
  chain: string;
  address: string;
  expires_at: Date;
  created_at: Date;
}
```

### OwnershipProof
```typescript
interface OwnershipProof {
  address: string;
  signature: string;
  message: string;
  verified: boolean;
  verified_at: Date | null;
}
```

## Recovery Service

### RecoveryService
```typescript
class RecoveryService {
  constructor(
    private chainRegistry: ChainRegistry,
    private intentService: PaymentIntentService,
    private complianceLayer: ComplianceLayer,
    private notificationService: NotificationService
  ) {}

  async detectMisdirectedPayment(
    txHash: string,
    sourceChain: string
  ): Promise<RecoveryCase> {
    // Get transaction details
    const chainClient = this.chainRegistry.get(sourceChain);
    const tx = await chainClient!.getTransaction(txHash);
    
    // Check if address is a known deposit address
    const isDepositAddress = await this.isDepositAddress(tx.to, sourceChain);
    
    if (!isDepositAddress) {
      // Check if it's a known customer address
      const customerAddress = await this.findCustomerAddress(tx.from);
      
      if (customerAddress) {
        return this.createRecoveryCase({
          case_type: RecoveryCaseType.MISDIRECTED,
          customer_address: tx.from,
          customer_chain: sourceChain,
          intended_chain: customerAddress.preferred_chain,
          asset: tx.asset,
          amount: tx.amount,
          tx_hash: txHash
        });
      }
    }
    
    // Check for wrong-chain deposit
    const intendedChain = await this.determineIntendedChain(tx.to, sourceChain);
    if (intendedChain && intendedChain !== sourceChain) {
      return this.createRecoveryCase({
        case_type: RecoveryCaseType.MISDIRECTED,
        customer_address: tx.from,
        customer_chain: sourceChain,
        intended_chain: intendedChain,
        asset: tx.asset,
        amount: tx.amount,
        tx_hash: txHash
      });
    }
    
    throw new Error('Not a misdirected payment');
  }

  async detectUnderpayment(
    intentId: string,
    actualAmount: number
  ): Promise<RecoveryCase> {
    const intent = await this.intentService.findById(intentId);
    if (!intent) {
      throw new Error('Intent not found');
    }

    if (actualAmount >= intent.target_amount) {
      throw new Error('Not an underpayment');
    }

    const shortfall = intent.target_amount - actualAmount;
    
    return this.createRecoveryCase({
      related_intent_id: intentId,
      case_type: RecoveryCaseType.UNDERPAID,
      customer_address: intent.source_address,
      customer_chain: intent.source_chain,
      intended_chain: intent.target_chain,
      asset: intent.target_asset,
      amount: shortfall,
      tx_hash: null
    });
  }

  async detectOverpayment(
    intentId: string,
    actualAmount: number
  ): Promise<RecoveryCase> {
    const intent = await this.intentService.findById(intentId);
    if (!intent) {
      throw new Error('Intent not found');
    }

    if (actualAmount <= intent.target_amount) {
      throw new Error('Not an overpayment');
    }

    const excess = actualAmount - intent.target_amount;
    
    return this.createRecoveryCase({
      related_intent_id: intentId,
      case_type: RecoveryCaseType.OVERPAID,
      customer_address: intent.source_address,
      customer_chain: intent.source_chain,
      intended_chain: intent.target_chain,
      asset: intent.target_asset,
      amount: excess,
      tx_hash: null
    });
  }

  async detectStuckTransaction(
    txHash: string,
    chain: string
  ): Promise<RecoveryCase> {
    const chainClient = this.chainRegistry.get(chain);
    const txStatus = await chainClient!.getTransactionStatus(txHash);
    
    if (txStatus.status !== 'PENDING') {
      throw new Error('Transaction is not stuck');
    }

    // Check if transaction has been pending too long
    const pendingTime = Date.now() - txStatus.timestamp.getTime();
    const maxPendingTime = 30 * 60 * 1000; // 30 minutes
    
    if (pendingTime < maxPendingTime) {
      throw new Error('Transaction not stuck long enough');
    }

    return this.createRecoveryCase({
      case_type: RecoveryCaseType.STUCK,
      customer_address: txStatus.from,
      customer_chain: chain,
      intended_chain: chain,
      asset: txStatus.asset,
      amount: txStatus.amount,
      tx_hash: txHash
    });
  }

  private async createRecoveryCase(
    data: Partial<RecoveryCase>
  ): Promise<RecoveryCase> {
    const recoveryCase: RecoveryCase = {
      id: crypto.randomUUID(),
      ...data,
      status: RecoveryStatus.DETECTED,
      resolution_action: null,
      resolution_tx_hash: null,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null
    } as RecoveryCase;

    // Save to database
    await this.saveRecoveryCase(recoveryCase);

    // Notify customer
    await this.notifyCustomer(recoveryCase);

    return recoveryCase;
  }

  private async isDepositAddress(
    address: string,
    chain: string
  ): Promise<boolean> {
    // Check if address is a known deposit address
    return false;
  }

  private async findCustomerAddress(
    address: string
  ): Promise<{ preferred_chain: string } | null> {
    // Find customer by address
    return null;
  }

  private async determineIntendedChain(
    address: string,
    sourceChain: string
  ): Promise<string | null> {
    // Determine intended chain based on address
    return null;
  }

  private async saveRecoveryCase(
    recoveryCase: RecoveryCase
  ): Promise<void> {
    // Save to database
  }

  private async notifyCustomer(
    recoveryCase: RecoveryCase
  ): Promise<void> {
    // Send notification to customer
  }
}
```

## Resolution Handlers

### MisdirectedPaymentResolver
```typescript
class MisdirectedPaymentResolver {
  constructor(
    private chainRegistry: ChainRegistry,
    private complianceLayer: ComplianceLayer
  ) {}

  async resolve(
    recoveryCase: RecoveryCase,
    proof: OwnershipProof
  ): Promise<ResolutionResult> {
    // Verify ownership
    const verified = await this.verifyOwnership(proof);
    if (!verified) {
      throw new Error('Ownership verification failed');
    }

    // Screen for compliance
    const complianceResult = await this.complianceLayer.screenAddress(
      recoveryCase.customer_address,
      recoveryCase.customer_chain
    );

    if (complianceResult.blocked) {
      throw new Error('Compliance check failed');
    }

    // Determine resolution action
    const action = this.determineAction(recoveryCase);
    
    // Execute resolution
    const result = await this.executeResolution(recoveryCase, action);
    
    return result;
  }

  private async verifyOwnership(proof: OwnershipProof): Promise<boolean> {
    // Verify signature
    const recoveredAddress = ethers.utils.verifyMessage(
      proof.message,
      proof.signature
    );
    
    return recoveredAddress.toLowerCase() === proof.address.toLowerCase();
  }

  private determineAction(
    recoveryCase: RecoveryCase
  ): ResolutionAction {
    // If same value, different chain → auto-credit
    if (recoveryCase.customer_chain !== recoveryCase.intended_chain) {
      return ResolutionAction.AUTO_CREDIT;
    }
    
    // Otherwise → auto-refund
    return ResolutionAction.AUTO_REFUND;
  }

  private async executeResolution(
    recoveryCase: RecoveryCase,
    action: ResolutionAction
  ): Promise<ResolutionResult> {
    switch (action) {
      case ResolutionAction.AUTO_CREDIT:
        return this.autoCredit(recoveryCase);
      case ResolutionAction.AUTO_REFUND:
        return this.autoRefund(recoveryCase);
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  private async autoCredit(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Credit customer account
    return {
      action: ResolutionAction.AUTO_CREDIT,
      success: true,
      tx_hash: null,
      message: 'Account credited successfully'
    };
  }

  private async autoRefund(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Refund to customer
    const chainClient = this.chainRegistry.get(recoveryCase.customer_chain);
    
    const tx: UnsignedTx = {
      from: await this.getRefundAddress(recoveryCase.customer_chain),
      to: recoveryCase.customer_address,
      value: recoveryCase.amount.toString(),
      data: '0x'
    };

    const gasEstimate = await chainClient!.estimateGas(tx);
    const signedTx = await this.signRefundTx(tx, recoveryCase.customer_chain);
    const result = await chainClient!.submitTransaction(signedTx);

    return {
      action: ResolutionAction.AUTO_REFUND,
      success: true,
      tx_hash: result.txHash,
      message: 'Refund sent successfully'
    };
  }

  private async getRefundAddress(chain: string): Promise<string> {
    // Get refund address
    return '0x...';
  }

  private async signRefundTx(
    tx: UnsignedTx,
    chain: string
  ): Promise<SignedTx> {
    // Sign transaction
    return { signedData: '0x...' };
  }
}

interface ResolutionResult {
  action: ResolutionAction;
  success: boolean;
  tx_hash: string | null;
  message: string;
}
```

### UnderpaymentResolver
```typescript
class UnderpaymentResolver {
  constructor(
    private intentService: PaymentIntentService,
    private rateLockService: RateLockService
  ) {}

  async resolve(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Get original intent
    const intent = await this.intentService.findById(
      recoveryCase.related_intent_id!
    );

    // Create top-up link
    const topUpLink = await this.createTopUpLink(recoveryCase, intent);

    // Notify customer
    await this.notifyCustomer(recoveryCase, topUpLink);

    return {
      action: ResolutionAction.TOP_UP_LINK,
      success: true,
      tx_hash: null,
      message: `Top-up link created for ${recoveryCase.amount} ${recoveryCase.asset}`
    };
  }

  private async createTopUpLink(
    recoveryCase: RecoveryCase,
    intent: PaymentIntent
  ): Promise<TopUpLink> {
    // Get current rate
    const rate = await this.rateLockService.getRate(
      recoveryCase.asset,
      intent.target_asset
    );

    const topUpAmount = recoveryCase.amount;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    return {
      id: crypto.randomUUID(),
      recovery_case_id: recoveryCase.id,
      amount: topUpAmount,
      asset: recoveryCase.asset,
      chain: recoveryCase.customer_chain,
      address: await this.getTopUpAddress(recoveryCase.customer_chain),
      expires_at: expiresAt,
      created_at: new Date()
    };
  }

  private async getTopUpAddress(chain: string): Promise<string> {
    // Get top-up address
    return '0x...';
  }

  private async notifyCustomer(
    recoveryCase: RecoveryCase,
    topUpLink: TopUpLink
  ): Promise<void> {
    // Send notification with top-up link
  }
}
```

### OverpaymentResolver
```typescript
class OverpaymentResolver {
  constructor(
    private intentService: PaymentIntentService,
    private chainRegistry: ChainRegistry
  ) {}

  async resolve(
    recoveryCase: RecoveryCase,
    preference: 'REFUND' | 'CREDIT'
  ): Promise<ResolutionResult> {
    if (preference === 'REFUND') {
      return this.refundExcess(recoveryCase);
    } else {
      return this.creditExcess(recoveryCase);
    }
  }

  private async refundExcess(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    const chainClient = this.chainRegistry.get(recoveryCase.customer_chain);
    
    const tx: UnsignedTx = {
      from: await this.getRefundAddress(recoveryCase.customer_chain),
      to: recoveryCase.customer_address,
      value: recoveryCase.amount.toString(),
      data: '0x'
    };

    const gasEstimate = await chainClient!.estimateGas(tx);
    const signedTx = await this.signRefundTx(tx, recoveryCase.customer_chain);
    const result = await chainClient!.submitTransaction(signedTx);

    return {
      action: ResolutionAction.AUTO_REFUND,
      success: true,
      tx_hash: result.txHash,
      message: 'Excess refunded successfully'
    };
  }

  private async creditExcess(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Credit customer account
    return {
      action: ResolutionAction.AUTO_CREDIT,
      success: true,
      tx_hash: null,
      message: 'Excess credited to account'
    };
  }

  private async getRefundAddress(chain: string): Promise<string> {
    return '0x...';
  }

  private async signRefundTx(
    tx: UnsignedTx,
    chain: string
  ): Promise<SignedTx> {
    return { signedData: '0x...' };
  }
}
```

### StuckTransactionResolver
```typescript
class StuckTransactionResolver {
  constructor(
    private chainRegistry: ChainRegistry,
    private relayerService: RelayerService
  ) {}

  async resolve(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    const chainClient = this.chainRegistry.get(recoveryCase.customer_chain);
    
    // Check if chain supports RBF
    if (this.supportsRBF(recoveryCase.customer_chain)) {
      return this加速WithRBF(recoveryCase);
    } else {
      return this.accelerateWithRelayer(recoveryCase);
    }
  }

  private supportsRBF(chain: string): boolean {
    // Check if chain supports RBF
    const rbfChains = ['1', '3', '4']; // Bitcoin mainnet, testnet, signet
    return rbfChains.includes(chain);
  }

  private async accelerateWithRBF(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Create RBF transaction
    const chainClient = this.chainRegistry.get(recoveryCase.customer_chain);
    
    const rbfTx = await chainClient!.createRBFTx(
      recoveryCase.tx_hash!,
      recoveryCase.amount
    );

    const signedTx = await this.signRBFTx(rbfTx, recoveryCase.customer_chain);
    const result = await chainClient!.submitTransaction(signedTx);

    return {
      action: ResolutionAction.FEE_BUMP,
      success: true,
      tx_hash: result.txHash,
      message: 'Transaction accelerated via RBF'
    };
  }

  private async accelerateWithRelayer(
    recoveryCase: RecoveryCase
  ): Promise<ResolutionResult> {
    // Use relayer to accelerate
    const result = await this.relayerService.accelerate(
      recoveryCase.tx_hash!,
      recoveryCase.customer_chain
    );

    return {
      action: ResolutionAction.RELAYER_ACCELERATION,
      success: result.success,
      tx_hash: result.new_tx_hash,
      message: result.success ? 
        'Transaction accelerated via relayer' : 
        'Failed to accelerate transaction'
    };
  }

  private async signRBFTx(
    tx: any,
    chain: string
  ): Promise<SignedTx> {
    return { signedData: '0x...' };
  }
}
```

## Relayer Service

### RelayerService
```typescript
class RelayerService {
  constructor(
    private chainRegistry: ChainRegistry,
    private gasEstimationService: GasEstimationService
  ) {}

  async accelerate(
    txHash: string,
    chain: string
  ): Promise<RelayerResult> {
    const chainClient = this.chainRegistry.get(chain);
    
    // Get original transaction
    const originalTx = await chainClient!.getTransaction(txHash);
    
    // Estimate new gas price
    const currentGasPrice = await this.gasEstimationService.getGasPrice(chain);
    const newGasPrice = currentGasPrice * 1.5; // 50% increase
    
    // Create acceleration transaction
    const accelTx: UnsignedTx = {
      from: originalTx.from,
      to: originalTx.to,
      value: originalTx.value,
      data: originalTx.data,
      gasPrice: newGasPrice
    };

    // Sign and submit
    const signedTx = await this.signAccelerationTx(accelTx, chain);
    const result = await chainClient!.submitTransaction(signedTx);

    return {
      success: true,
      original_tx_hash: txHash,
      new_tx_hash: result.txHash,
      new_gas_price: newGasPrice
    };
  }

  private async signAccelerationTx(
    tx: UnsignedTx,
    chain: string
  ): Promise<SignedTx> {
    return { signedData: '0x...' };
  }
}

interface RelayerResult {
  success: boolean;
  original_tx_hash: string;
  new_tx_hash: string;
  new_gas_price: number;
}
```

## Error Handling

### Error Types
```typescript
enum RecoveryError {
  OWNERSHIP_VERIFICATION_FAILED = 'OWNERSHIP_VERIFICATION_FAILED',
  COMPLIANCE_CHECK_FAILED = 'COMPLIANCE_CHECK_FAILED',
  REFUND_FAILED = 'REFUND_FAILED',
  TOP_UP_FAILED = 'TOP_UP_FAILED',
  ACCELERATION_FAILED = 'ACCELERATION_FAILED'
}
```

### Error Recovery
```typescript
class RecoveryErrorRecovery {
  async handleRecoveryFailure(
    recoveryCase: RecoveryCase,
    error: Error
  ): Promise<void> {
    // Update recovery case status
    await this.updateRecoveryCase(recoveryCase.id, {
      status: RecoveryStatus.FAILED,
      updated_at: new Date()
    });

    // Notify support team
    await this.notifySupport(recoveryCase, error);

    // Log error
    await this.logError(recoveryCase, error);
  }

  private async updateRecoveryCase(
    id: string,
    data: Partial<RecoveryCase>
  ): Promise<void> {
    // Update database
  }

  private async notifySupport(
    recoveryCase: RecoveryCase,
    error: Error
  ): Promise<void> {
    // Send notification to support team
  }

  private async logError(
    recoveryCase: RecoveryCase,
    error: Error
  ): Promise<void> {
    // Log error
  }
}
```

## Testing Strategy

### Unit Tests
1. Misdirected payment detection
2. Underpayment/overpayment handling
3. Stuck transaction detection
4. Ownership verification

### Integration Tests
1. End-to-end recovery flow
2. Refund execution
3. Top-up link generation
4. RBF acceleration

### Load Tests
1. High-volume recovery cases
2. Concurrent resolution attempts
3. Refund processing
4. Acceleration performance

## Performance Requirements

### Latency
- Detection: < 1s
- Resolution: < 5s
- Refund execution: < 30s
- Acceleration: < 10s

### Throughput
- 100+ detections per minute
- 50+ resolutions per minute
- 20+ refunds per minute

### Availability
- 99.9% uptime for recovery service
- Graceful degradation on chain failures
- Automatic failover for critical operations

## Security Considerations

### Ownership Verification
- Verify cryptographic signatures
- Implement challenge-response
- Prevent replay attacks

### Refund Security
- Validate refund addresses
- Implement rate limiting
- Monitor for abuse

### Compliance
- Screen all recovery transactions
- Maintain audit trails
- Report suspicious activity
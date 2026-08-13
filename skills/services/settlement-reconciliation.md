# Settlement and Reconciliation Skill

## Purpose
This skill defines the implementation guidelines for Settlement and Reconciliation - the components responsible for merchant payout and financial accounting.

## Core Responsibilities

### 1. Settlement Execution
- Execute final payout to merchants in configured asset/chain
- Confirm against rate-locked amounts
- Handle settlement failures and retries

### 2. Ledger Management
- Maintain double-entry ledger
- Track all financial movements
- Generate financial reports

### 3. Reconciliation
- Match on-chain events with ledger entries
- Detect discrepancies
- Generate reconciliation reports

## Data Model

### Settlement
```typescript
interface Settlement {
  id: string;
  intent_id: string;
  merchant_id: string;
  amount: number;
  asset: string;
  chain: string;
  destination_address: string;
  status: SettlementStatus;
  tx_hash?: string;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

enum SettlementStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING'
}
```

### LedgerEntry
```typescript
interface LedgerEntry {
  id: string;
  intent_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  asset: string;
  chain: string;
  debit_account: string;
  credit_account: string;
  metadata: any;
  created_at: Date;
}

enum LedgerEntryType {
  DEPOSIT = 'DEPOSIT',
  FEE = 'FEE',
  SETTLEMENT = 'SETTLEMENT',
  REFUND = 'REFUND',
  FX_GAIN_LOSS = 'FX_GAIN_LOSS'
}
```

### ReconciliationReport
```typescript
interface ReconciliationReport {
  id: string;
  period: string;
  total_intents: number;
  total_settled: number;
  total_pending: number;
  total_failed: number;
  discrepancies: Discrepancy[];
  generated_at: Date;
}

interface Discrepancy {
  type: DiscrepancyType;
  intent_id: string;
  expected: number;
  actual: number;
  difference: number;
  description: string;
}

enum DiscrepancyType {
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  MISSING_SETTLEMENT = 'MISSING_SETTLEMENT',
  DUPLICATE_SETTLEMENT = 'DUPLICATE_SETTLEMENT',
  INVALID_STATUS = 'INVALID_STATUS'
}
```

## Settlement Service

### SettlementService
```typescript
class SettlementService {
  constructor(
    private chainRegistry: ChainRegistry,
    private ledgerService: LedgerService,
    private merchantConfig: MerchantConfigService,
    private riskEngine: RiskEngine
  ) {}

  async settleIntent(intent: PaymentIntent): Promise<Settlement> {
    // Get merchant configuration
    const merchantConfig = await this.merchantConfig.get(intent.merchant_id);
    
    // Calculate settlement amount
    const settlementAmount = this.calculateSettlementAmount(
      intent,
      merchantConfig
    );

    // Create settlement record
    const settlement = await this.createSettlement({
      intent_id: intent.id,
      merchant_id: intent.merchant_id,
      amount: settlementAmount,
      asset: merchantConfig.settlement_asset,
      chain: merchantConfig.settlement_chain,
      destination_address: merchantConfig.settlement_address,
      status: SettlementStatus.PENDING
    });

    // Execute settlement
    try {
      const result = await this.executeSettlement(settlement);
      
      // Update settlement status
      await this.updateSettlement(settlement.id, {
        status: SettlementStatus.COMPLETED,
        tx_hash: result.txHash,
        completed_at: new Date()
      });

      // Record in ledger
      await this.ledgerService.recordSettlement(settlement);

      return settlement;
    } catch (error) {
      // Handle settlement failure
      await this.handleSettlementFailure(settlement, error);
      throw error;
    }
  }

  private calculateSettlementAmount(
    intent: PaymentIntent,
    merchantConfig: MerchantConfig
  ): number {
    // Use rate-locked amount
    const baseAmount = intent.target_amount;
    
    // Deduct merchant fees
    const feePercentage = merchantConfig.fee_percentage || 0;
    const fee = baseAmount * (feePercentage / 100);
    
    return baseAmount - fee;
  }

  private async executeSettlement(
    settlement: Settlement
  ): Promise<TxResult> {
    const chainClient = this.chainRegistry.get(settlement.chain);
    if (!chainClient) {
      throw new Error(`Chain ${settlement.chain} not supported`);
    }

    // Create transaction
    const tx: UnsignedTx = {
      from: await this.getSettlementAddress(settlement.chain),
      to: settlement.destination_address,
      value: settlement.amount.toString(),
      data: '0x'
    };

    // Estimate gas
    const gasEstimate = await chainClient.estimateGas(tx);
    
    // Sign and submit transaction
    const signedTx = await this.signTransaction(tx, settlement.chain);
    return chainClient.submitTransaction(signedTx);
  }

  private async getSettlementAddress(chain: string): Promise<string> {
    // Get hot wallet address for the chain
    return '0x...';
  }

  private async signTransaction(
    tx: UnsignedTx,
    chain: string
  ): Promise<SignedTx> {
    // Sign transaction with hot wallet
    return {
      signedData: '0x...'
    };
  }

  private async createSettlement(
    data: Partial<Settlement>
  ): Promise<Settlement> {
    // Create settlement record in database
    return {
      id: crypto.randomUUID(),
      ...data,
      created_at: new Date(),
      updated_at: new Date()
    } as Settlement;
  }

  private async updateSettlement(
    id: string,
    data: Partial<Settlement>
  ): Promise<void> {
    // Update settlement record in database
  }

  private async handleSettlementFailure(
    settlement: Settlement,
    error: Error
  ): Promise<void> {
    // Update settlement status to failed
    await this.updateSettlement(settlement.id, {
      status: SettlementStatus.FAILED,
      updated_at: new Date()
    });

    // Schedule retry if retryable error
    if (this.isRetryableError(error)) {
      await this.scheduleRetry(settlement);
    }
  }

  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'INSUFFICIENT_GAS'
    ];
    
    return retryableErrors.some(e => error.message.includes(e));
  }

  private async scheduleRetry(settlement: Settlement): Promise<void> {
    // Implement retry scheduling with exponential backoff
    await this.updateSettlement(settlement.id, {
      status: SettlementStatus.RETRYING,
      updated_at: new Date()
    });
  }
}
```

## Ledger Service

### LedgerService
```typescript
class LedgerService {
  constructor(private db: Database) {}

  async recordDeposit(deposit: Deposit): Promise<LedgerEntry> {
    return this.createEntry({
      intent_id: deposit.intent_id,
      entry_type: LedgerEntryType.DEPOSIT,
      amount: deposit.amount,
      asset: deposit.asset,
      chain: deposit.chain,
      debit_account: `customer:${deposit.customer_id}`,
      credit_account: `pending:${deposit.intent_id}`,
      metadata: {
        tx_hash: deposit.tx_hash,
        source_address: deposit.source_address
      }
    });
  }

  async recordFee(fee: Fee): Promise<LedgerEntry> {
    return this.createEntry({
      intent_id: fee.intent_id,
      entry_type: LedgerEntryType.FEE,
      amount: fee.amount,
      asset: fee.asset,
      chain: fee.chain,
      debit_account: `merchant:${fee.merchant_id}`,
      credit_account: `revenue:fees`,
      metadata: {
        fee_type: fee.type,
        percentage: fee.percentage
      }
    });
  }

  async recordSettlement(settlement: Settlement): Promise<LedgerEntry> {
    return this.createEntry({
      intent_id: settlement.intent_id,
      entry_type: LedgerEntryType.SETTLEMENT,
      amount: settlement.amount,
      asset: settlement.asset,
      chain: settlement.chain,
      debit_account: `pending:${settlement.intent_id}`,
      credit_account: `merchant:${settlement.merchant_id}`,
      metadata: {
        tx_hash: settlement.tx_hash,
        destination_address: settlement.destination_address
      }
    });
  }

  async recordRefund(refund: Refund): Promise<LedgerEntry> {
    return this.createEntry({
      intent_id: refund.intent_id,
      entry_type: LedgerEntryType.REFUND,
      amount: refund.amount,
      asset: refund.asset,
      chain: refund.chain,
      debit_account: `merchant:${refund.merchant_id}`,
      credit_account: `customer:${refund.customer_id}`,
      metadata: {
        tx_hash: refund.tx_hash,
        reason: refund.reason
      }
    });
  }

  async recordFxGainLoss(
    intent_id: string,
    asset: string,
    chain: string,
    gain: number
  ): Promise<LedgerEntry> {
    const entryType = gain >= 0 ? 
      LedgerEntryType.FX_GAIN_LOSS : 
      LedgerEntryType.FX_GAIN_LOSS;

    return this.createEntry({
      intent_id,
      entry_type: entryType,
      amount: Math.abs(gain),
      asset,
      chain,
      debit_account: gain >= 0 ? `revenue:fx` : `expense:fx`,
      credit_account: gain >= 0 ? `expense:fx` : `revenue:fx`,
      metadata: {
        type: gain >= 0 ? 'gain' : 'loss'
      }
    });
  }

  async getBalance(
    accountId: string,
    asset: string
  ): Promise<number> {
    const debits = await this.sumAmounts(accountId, asset, 'debit');
    const credits = await this.sumAmounts(accountId, asset, 'credit');
    return debits - credits;
  }

  async getMerchantBalance(
    merchantId: string,
    asset: string
  ): Promise<number> {
    return this.getBalance(`merchant:${merchantId}`, asset);
  }

  async getStatement(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<LedgerStatement> {
    const entries = await this.getEntries(accountId, startDate, endDate);
    
    return {
      account_id: accountId,
      start_date: startDate,
      end_date: endDate,
      opening_balance: await this.getBalance(accountId, 'USD'),
      entries,
      closing_balance: await this.getBalance(accountId, 'USD')
    };
  }

  private async createEntry(
    data: Partial<LedgerEntry>
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      ...data,
      created_at: new Date()
    } as LedgerEntry;

    await this.db.insert('ledger_entries', entry);
    return entry;
  }

  private async sumAmounts(
    accountId: string,
    asset: string,
    type: 'debit' | 'credit'
  ): Promise<number> {
    const result = await this.db.query(
      `SELECT SUM(amount) as total FROM ledger_entries 
       WHERE ${type}_account = ? AND asset = ?`,
      [accountId, asset]
    );
    return result[0]?.total || 0;
  }

  private async getEntries(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<LedgerEntry[]> {
    return this.db.query(
      `SELECT * FROM ledger_entries 
       WHERE (debit_account = ? OR credit_account = ?) 
       AND created_at BETWEEN ? AND ?
       ORDER BY created_at`,
      [accountId, accountId, startDate, endDate]
    );
  }
}
```

## Reconciliation Service

### ReconciliationService
```typescript
class ReconciliationService {
  constructor(
    private chainRegistry: ChainRegistry,
    private ledgerService: LedgerService,
    private settlementService: SettlementService
  ) {}

  async reconcilePeriod(
    startDate: Date,
    endDate: Date
  ): Promise<ReconciliationReport> {
    // Get all intents in period
    const intents = await this.getIntentsInPeriod(startDate, endDate);
    
    const discrepancies: Discrepancy[] = [];
    let totalSettled = 0;
    let totalPending = 0;
    let totalFailed = 0;

    for (const intent of intents) {
      const reconciliation = await this.reconcileIntent(intent);
      
      if (reconciliation.discrepancy) {
        discrepancies.push(reconciliation.discrepancy);
      }

      switch (intent.state) {
        case 'SETTLED':
          totalSettled++;
          break;
        case 'SETTLING':
        case 'ROUTING':
          totalPending++;
          break;
        case 'FAILED':
          totalFailed++;
          break;
      }
    }

    return {
      id: crypto.randomUUID(),
      period: `${startDate.toISOString()} - ${endDate.toISOString()}`,
      total_intents: intents.length,
      total_settled: totalSettled,
      total_pending: totalPending,
      total_failed: totalFailed,
      discrepancies,
      generated_at: new Date()
    };
  }

  private async reconcileIntent(
    intent: PaymentIntent
  ): Promise<{ discrepancy: Discrepancy | null }> {
    // Get ledger entries for intent
    const ledgerEntries = await this.ledgerService.getEntriesByIntent(intent.id);
    
    // Get on-chain transactions
    const onChainTxs = await this.getOnChainTransactions(intent);
    
    // Compare
    const discrepancy = this.compareEntries(intent, ledgerEntries, onChainTxs);
    
    return { discrepancy };
  }

  private async getOnChainTransactions(
    intent: PaymentIntent
  ): Promise<any[]> {
    const chainClient = this.chainRegistry.get(intent.target_chain);
    if (!chainClient) {
      return [];
    }

    // Get transactions for settlement address
    const address = await this.getSettlementAddress(intent.target_chain);
    return chainClient.getTransactions(address, intent.created_at);
  }

  private compareEntries(
    intent: PaymentIntent,
    ledgerEntries: LedgerEntry[],
    onChainTxs: any[]
  ): Discrepancy | null {
    // Check for amount mismatches
    const depositEntry = ledgerEntries.find(e => 
      e.entry_type === LedgerEntryType.DEPOSIT
    );
    const settlementEntry = ledgerEntries.find(e => 
      e.entry_type === LedgerEntryType.SETTLEMENT
    );

    if (depositEntry && settlementEntry) {
      const expectedAmount = depositEntry.amount;
      const actualAmount = settlementEntry.amount;
      
      if (Math.abs(expectedAmount - actualAmount) > 0.0001) {
        return {
          type: DiscrepancyType.AMOUNT_MISMATCH,
          intent_id: intent.id,
          expected: expectedAmount,
          actual: actualAmount,
          difference: expectedAmount - actualAmount,
          description: `Settlement amount mismatch: expected ${expectedAmount}, got ${actualAmount}`
        };
      }
    }

    // Check for missing settlements
    if (intent.state === 'SETTLED' && !settlementEntry) {
      return {
        type: DiscrepancyType.MISSING_SETTLEMENT,
        intent_id: intent.id,
        expected: intent.target_amount,
        actual: 0,
        difference: intent.target_amount,
        description: 'Intent marked as settled but no settlement entry found'
      };
    }

    return null;
  }

  private async getSettlementAddress(chain: string): Promise<string> {
    // Get settlement address for chain
    return '0x...';
  }

  private async getIntentsInPeriod(
    startDate: Date,
    endDate: Date
  ): Promise<PaymentIntent[]> {
    // Query intents in period
    return [];
  }
}
```

## Error Handling

### Error Types
```typescript
enum SettlementError {
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RECONCILIATION_FAILED = 'RECONCILIATION_FAILED'
}
```

### Error Recovery
```typescript
class SettlementErrorRecovery {
  async retryWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (this.isNonRetryableError(error)) {
          throw error;
        }
        
        const delay = Math.pow(2, attempt) * 1000;
        await this.delay(delay);
      }
    }
    
    throw lastError!;
  }

  private isNonRetryableError(error: any): boolean {
    const nonRetryableErrors = [
      SettlementError.INVALID_ADDRESS,
      SettlementError.INSUFFICIENT_BALANCE
    ];
    
    return nonRetryableErrors.includes(error.code);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Testing Strategy

### Unit Tests
1. Settlement amount calculation
2. Ledger entry creation
3. Reconciliation comparison
4. Error handling

### Integration Tests
1. End-to-end settlement flow
2. Ledger consistency
3. Reconciliation accuracy
4. Retry mechanisms

### Load Tests
1. High-volume settlements
2. Concurrent ledger operations
3. Reconciliation performance
4. Database scalability

## Performance Requirements

### Latency
- Settlement execution: < 5s
- Ledger entry creation: < 100ms
- Reconciliation check: < 500ms
- Balance query: < 50ms

### Throughput
- 100+ settlements per minute
- 1,000+ ledger entries per minute
- 10+ reconciliation reports per hour

### Availability
- 99.99% uptime for settlement service
- Graceful degradation on chain failures
- Automatic failover for critical operations

## Security Considerations

### Key Management
- Use HSM for hot wallet keys
- Implement key rotation
- Monitor key usage

### Transaction Security
- Validate all transaction parameters
- Implement rate limiting
- Monitor for suspicious activity

### Financial Controls
- Implement approval workflows for large settlements
- Maintain audit trails
- Regular reconciliation
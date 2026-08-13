# Security and Compliance Skill

## Purpose
This skill defines the implementation guidelines for Security and Compliance - the pluggable layer that handles KYC/AML/sanctions screening without touching core routing logic.

## Core Responsibilities

### 1. Sanctions Screening
- Screen addresses against OFAC and other sanctions lists
- Real-time screening at intent creation and settlement
- Configurable thresholds per merchant

### 2. KYC/AML Compliance
- Customer due diligence for high-value transactions
- Transaction monitoring for suspicious activity
- Regulatory reporting requirements

### 3. Risk Scoring
- Wallet reputation analysis
- Transaction pattern analysis
- Velocity monitoring

## Data Model

### RiskResult
```typescript
interface RiskResult {
  address: string;
  chain: string;
  riskScore: number;
  riskLevel: RiskLevel;
  flags: RiskFlag[];
  details: RiskDetails;
  screenedAt: Date;
  expiresAt: Date;
}

enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

enum RiskFlag {
  SANCTIONED = 'SANCTIONED',
  MIXER = 'MIXER',
  DARKNET = 'DARKNET',
  SCAM = 'SCAM',
  HIGH_RISK_JURISDICTION = 'HIGH_RISK_JURISDICTION',
  VELOCITY_ANOMALY = 'VELOCITY_ANOMALY',
  NEW_ADDRESS = 'NEW_ADDRESS'
}

interface RiskDetails {
  sanctionsMatch: SanctionsMatch | null;
  walletAge: number;
  transactionCount: number;
  totalVolume: number;
  knownAssociations: string[];
  jurisdictionRisk: number;
}
```

### SanctionsMatch
```typescript
interface SanctionsMatch {
  listName: string;
  matchScore: number;
  entityName: string;
  entityDetails: any;
}
```

### KYCRequirement
```typescript
interface KYCRequirement {
  merchantId: string;
  threshold: number;
  requiredDocuments: KYCDocument[];
  verificationLevel: KYCLevel;
}

enum KYCLevel {
  NONE = 'NONE',
  BASIC = 'BASIC',
  ENHANCED = 'ENHANCED',
  FULL = 'FULL'
}

enum KYCDocument {
  ID_DOCUMENT = 'ID_DOCUMENT',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
  SELFIE = 'SELFIE',
  SOURCE_OF_FUNDS = 'SOURCE_OF_FUNDS'
}
```

## Risk Scorer Interface

### IRiskScorer
```typescript
interface IRiskScorer {
  screenAddress(address: string, chain: string): Promise<RiskResult>;
  screenTransaction(tx: TransactionInfo): Promise<RiskResult>;
  getRiskScore(address: string): Promise<number>;
  updateRiskFactors(address: string, factors: RiskFactor[]): Promise<void>;
}

interface TransactionInfo {
  from: string;
  to: string;
  amount: number;
  asset: string;
  chain: string;
  timestamp: Date;
}

interface RiskFactor {
  type: string;
  weight: number;
  value: any;
}
```

## Vendor Implementations

### ChainalysisRiskScorer
```typescript
class ChainalysisRiskScorer implements IRiskScorer {
  constructor(
    private apiKey: string,
    private baseUrl: string
  ) {}

  async screenAddress(address: string, chain: string): Promise<RiskResult> {
    const response = await fetch(`${this.baseUrl}/addresses/${address}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    return this.parseRiskResult(address, chain, data);
  }

  async screenTransaction(tx: TransactionInfo): Promise<RiskResult> {
    const response = await fetch(`${this.baseUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_address: tx.from,
        to_address: tx.to,
        amount: tx.amount,
        asset: tx.asset,
        chain: tx.chain
      })
    });

    const data = await response.json();
    
    return this.parseRiskResult(tx.from, tx.chain, data);
  }

  async getRiskScore(address: string): Promise<number> {
    const result = await this.screenAddress(address, 'ethereum');
    return result.riskScore;
  }

  async updateRiskFactors(address: string, factors: RiskFactor[]): Promise<void> {
    // Chainalysis doesn't support updating factors
    // This is a no-op for this implementation
  }

  private parseRiskResult(address: string, chain: string, data: any): RiskResult {
    const riskScore = this.calculateRiskScore(data);
    const riskLevel = this.determineRiskLevel(riskScore);
    const flags = this.extractFlags(data);

    return {
      address,
      chain,
      riskScore,
      riskLevel,
      flags,
      details: {
        sanctionsMatch: data.sanctions?.match || null,
        walletAge: data.wallet_age || 0,
        transactionCount: data.transaction_count || 0,
        totalVolume: data.total_volume || 0,
        knownAssociations: data.known_associations || [],
        jurisdictionRisk: data.jurisdiction_risk || 0
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
  }

  private calculateRiskScore(data: any): number {
    let score = 0;
    
    if (data.sanctions?.match) score += 100;
    if (data.known_malicious) score += 80;
    if (data.mixer) score += 60;
    if (data.darknet) score += 70;
    if (data.scam) score += 50;
    if (data.high_risk_jurisdiction) score += 30;
    
    return Math.min(100, score);
  }

  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.CRITICAL;
    if (score >= 60) return RiskLevel.HIGH;
    if (score >= 40) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private extractFlags(data: any): RiskFlag[] {
    const flags: RiskFlag[] = [];
    
    if (data.sanctions?.match) flags.push(RiskFlag.SANCTIONED);
    if (data.mixer) flags.push(RiskFlag.MIXER);
    if (data.darknet) flags.push(RiskFlag.DARKNET);
    if (data.scam) flags.push(RiskFlag.SCAM);
    if (data.high_risk_jurisdiction) flags.push(RiskFlag.HIGH_RISK_JURISDICTION);
    
    return flags;
  }
}
```

### TRMLabsRiskScorer
```typescript
class TRMLabsRiskScorer implements IRiskScorer {
  constructor(
    private apiKey: string,
    private baseUrl: string
  ) {}

  async screenAddress(address: string, chain: string): Promise<RiskResult> {
    const response = await fetch(`${this.baseUrl}/v2/addresses/${address}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    return this.parseRiskResult(address, chain, data);
  }

  async screenTransaction(tx: TransactionInfo): Promise<RiskResult> {
    const response = await fetch(`${this.baseUrl}/v2/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        hash: tx.from,
        chain: tx.chain
      })
    });

    const data = await response.json();
    
    return this.parseRiskResult(tx.from, tx.chain, data);
  }

  async getRiskScore(address: string): Promise<number> {
    const result = await this.screenAddress(address, 'ethereum');
    return result.riskScore;
  }

  async updateRiskFactors(address: string, factors: RiskFactor[]): Promise<void> {
    // TRM doesn't support updating factors
    // This is a no-op for this implementation
  }

  private parseRiskResult(address: string, chain: string, data: any): RiskResult {
    const riskScore = data.risk_score || 0;
    const riskLevel = this.determineRiskLevel(riskScore);
    const flags = this.extractFlags(data);

    return {
      address,
      chain,
      riskScore,
      riskLevel,
      flags,
      details: {
        sanctionsMatch: data.sanctions || null,
        walletAge: data.wallet_age || 0,
        transactionCount: data.transaction_count || 0,
        totalVolume: data.total_volume || 0,
        knownAssociations: data.exposure || [],
        jurisdictionRisk: data.jurisdiction_risk || 0
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };
  }

  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.CRITICAL;
    if (score >= 60) return RiskLevel.HIGH;
    if (score >= 40) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private extractFlags(data: any): RiskFlag[] {
    const flags: RiskFlag[] = [];
    
    if (data.sanctions) flags.push(RiskFlag.SANCTIONED);
    if (data.malicious_actor) flags.push(RiskFlag.SCAM);
    if (data.risk_indicators?.mixer) flags.push(RiskFlag.MIXER);
    if (data.risk_indicators?.darknet) flags.push(RiskFlag.DARKNET);
    
    return flags;
  }
}
```

## Compliance Layer

### ComplianceLayer
```typescript
class ComplianceLayer {
  constructor(
    private riskScorer: IRiskScorer,
    private kycService: KYCService,
    private merchantConfig: MerchantConfigService
  ) {}

  async screenIntent(intent: PaymentIntent): Promise<ComplianceResult> {
    // Screen source address
    const sourceRisk = await this.riskScorer.screenAddress(
      intent.source_address,
      intent.source_chain
    );

    // Check KYC requirements
    const kycRequired = await this.checkKYCRequirement(intent);
    const kycVerified = kycRequired ? 
      await this.kycService.isVerified(intent.customer_id) : true;

    // Determine if transaction should be blocked
    const blocked = this.shouldBlock(sourceRisk, kycRequired, kycVerified);

    return {
      intentId: intent.id,
      sourceRisk,
      kycRequired,
      kycVerified,
      blocked,
      blockReason: blocked ? this.getBlockReason(sourceRisk, kycRequired, kycVerified) : null,
      screenedAt: new Date()
    };
  }

  async screenSettlement(settlement: Settlement): Promise<ComplianceResult> {
    // Screen destination address
    const destRisk = await this.riskScorer.screenAddress(
      settlement.destination_address,
      settlement.destination_chain
    );

    // Check merchant compliance
    const merchantCompliant = await this.checkMerchantCompliance(
      settlement.merchant_id
    );

    const blocked = destRisk.riskLevel === RiskLevel.CRITICAL || !merchantCompliant;

    return {
      intentId: settlement.intent_id,
      destinationRisk: destRisk,
      merchantCompliant,
      blocked,
      blockReason: blocked ? 
        (destRisk.riskLevel === RiskLevel.CRITICAL ? 'HIGH_RISK_DESTINATION' : 'MERCHANT_NON_COMPLIANT') : 
        null,
      screenedAt: new Date()
    };
  }

  private async checkKYCRequirement(intent: PaymentIntent): Promise<boolean> {
    const merchantConfig = await this.merchantConfig.get(intent.merchant_id);
    return intent.target_amount >= merchantConfig.kyc_threshold;
  }

  private shouldBlock(
    risk: RiskResult,
    kycRequired: boolean,
    kycVerified: boolean
  ): boolean {
    // Block if sanctions match
    if (risk.flags.includes(RiskFlag.SANCTIONED)) return true;
    
    // Block if high risk and KYC not verified
    if (risk.riskLevel === RiskLevel.HIGH && kycRequired && !kycVerified) return true;
    
    // Block if critical risk
    if (risk.riskLevel === RiskLevel.CRITICAL) return true;
    
    return false;
  }

  private getBlockReason(
    risk: RiskResult,
    kycRequired: boolean,
    kycVerified: boolean
  ): string {
    if (risk.flags.includes(RiskFlag.SANCTIONED)) return 'SANCTIONS_MATCH';
    if (risk.riskLevel === RiskLevel.CRITICAL) return 'HIGH_RISK_ADDRESS';
    if (kycRequired && !kycVerified) return 'KYC_NOT_VERIFIED';
    return 'UNKNOWN';
  }

  private async checkMerchantCompliance(merchantId: string): Promise<boolean> {
    const merchant = await this.merchantConfig.get(merchantId);
    return merchant.compliance_status === 'COMPLIANT';
  }
}
```

## KYC Service

### KYCService
```typescript
class KYCService {
  constructor(
    private verificationProvider: KYCVerificationProvider
  ) {}

  async initiateVerification(
    customerId: string,
    documents: KYCDocument[]
  ): Promise<KYCVerification> {
    const verification = await this.verificationProvider.createVerification({
      customerId,
      documents,
      createdAt: new Date()
    });

    return verification;
  }

  async isVerified(customerId: string): Promise<boolean> {
    const status = await this.verificationProvider.getStatus(customerId);
    return status === 'VERIFIED';
  }

  async getVerificationStatus(customerId: string): Promise<KYCVerification> {
    return this.verificationProvider.getStatus(customerId);
  }
}

interface KYCVerificationProvider {
  createVerification(request: any): Promise<KYCVerification>;
  getStatus(customerId: string): Promise<string>;
  submitDocument(document: any): Promise<void>;
}

interface KYCVerification {
  id: string;
  customerId: string;
  status: 'PENDING' | 'REVIEWING' | 'VERIFIED' | 'REJECTED';
  documents: KYCDocument[];
  createdAt: Date;
  verifiedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
}
```

## Transaction Monitoring

### TransactionMonitor
```typescript
class TransactionMonitor {
  constructor(
    private riskScorer: IRiskScorer,
    private alertService: AlertService
  ) {}

  async monitorTransaction(tx: TransactionInfo): Promise<MonitoringResult> {
    // Screen transaction
    const risk = await this.riskScorer.screenTransaction(tx);
    
    // Check velocity
    const velocityCheck = await this.checkVelocity(tx);
    
    // Check patterns
    const patternCheck = await this.checkPatterns(tx);
    
    // Determine if alert should be raised
    const shouldAlert = this.shouldAlert(risk, velocityCheck, patternCheck);
    
    if (shouldAlert) {
      await this.alertService.raiseAlert({
        type: 'SUSPICIOUS_TRANSACTION',
        transaction: tx,
        risk,
        velocityCheck,
        patternCheck,
        timestamp: new Date()
      });
    }

    return {
      transactionHash: tx.hash,
      risk,
      velocityCheck,
      patternCheck,
      shouldAlert,
      monitoredAt: new Date()
    };
  }

  private async checkVelocity(tx: TransactionInfo): Promise<VelocityCheck> {
    // Implement velocity checking
    return {
      transactionsLastHour: 0,
      transactionsLastDay: 0,
      volumeLastHour: 0,
      volumeLastDay: 0,
      isAnomaly: false
    };
  }

  private async checkPatterns(tx: TransactionInfo): Promise<PatternCheck> {
    // Implement pattern checking
    return {
      isStructuring: false,
      isRoundTripping: false,
      isUnusualPattern: false
    };
  }

  private shouldAlert(
    risk: RiskResult,
    velocity: VelocityCheck,
    patterns: PatternCheck
  ): boolean {
    if (risk.riskLevel === RiskLevel.HIGH || risk.riskLevel === RiskLevel.CRITICAL) return true;
    if (velocity.isAnomaly) return true;
    if (patterns.isStructuring || patterns.isRoundTripping) return true;
    return false;
  }
}

interface VelocityCheck {
  transactionsLastHour: number;
  transactionsLastDay: number;
  volumeLastHour: number;
  volumeLastDay: number;
  isAnomaly: boolean;
}

interface PatternCheck {
  isStructuring: boolean;
  isRoundTripping: boolean;
  isUnusualPattern: boolean;
}

interface MonitoringResult {
  transactionHash: string;
  risk: RiskResult;
  velocityCheck: VelocityCheck;
  patternCheck: PatternCheck;
  shouldAlert: boolean;
  monitoredAt: Date;
}
```

## Alert Service

### AlertService
```typescript
class AlertService {
  constructor(
    private notificationService: NotificationService,
    private auditLog: AuditLog
  ) {}

  async raiseAlert(alert: Alert): Promise<void> {
    // Log to audit trail
    await this.auditLog.log({
      type: 'COMPLIANCE_ALERT',
      data: alert,
      timestamp: new Date()
    });

    // Send notifications
    await this.notificationService.send({
      type: 'COMPLIANCE_ALERT',
      severity: this.determineSeverity(alert),
      recipients: await this.getRecipients(alert),
      message: this.formatAlertMessage(alert),
      data: alert
    });
  }

  private determineSeverity(alert: Alert): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (alert.risk.riskLevel === RiskLevel.CRITICAL) return 'CRITICAL';
    if (alert.risk.riskLevel === RiskLevel.HIGH) return 'HIGH';
    if (alert.velocityCheck.isAnomaly) return 'MEDIUM';
    return 'LOW';
  }

  private async getRecipients(alert: Alert): Promise<string[]> {
    // Get compliance team recipients
    return ['compliance@example.com'];
  }

  private formatAlertMessage(alert: Alert): string {
    return `Suspicious transaction detected: ${alert.transaction.hash}`;
  }
}

interface Alert {
  type: string;
  transaction: TransactionInfo;
  risk: RiskResult;
  velocityCheck: VelocityCheck;
  patternCheck: PatternCheck;
  timestamp: Date;
}
```

## Audit Log

### AuditLog
```typescript
class AuditLog {
  constructor(private db: Database) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.insert('audit_logs', {
      id: this.generateId(),
      type: entry.type,
      data: entry.data,
      timestamp: entry.timestamp,
      created_at: new Date()
    });
  }

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    return this.db.query('audit_logs', filter);
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}

interface AuditEntry {
  type: string;
  data: any;
  timestamp: Date;
}

interface AuditFilter {
  type?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
```

## Error Handling

### Error Types
```typescript
enum ComplianceError {
  SCREENING_FAILED = 'SCREENING_FAILED',
  KYC_VERIFICATION_FAILED = 'KYC_VERIFICATION_FAILED',
  VENDOR_UNAVAILABLE = 'VENDOR_UNAVAILABLE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED'
}
```

### Error Recovery
```typescript
class ComplianceErrorRecovery {
  async retryWithFallback<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>
  ): Promise<T> {
    try {
      return await primaryFn();
    } catch (error) {
      if (this.isRetryableError(error)) {
        return await fallbackFn();
      }
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      ComplianceError.VENDOR_UNAVAILABLE,
      ComplianceError.RATE_LIMIT_EXCEEDED
    ];
    
    return retryableErrors.includes(error.code);
  }
}
```

## Testing Strategy

### Unit Tests
1. Risk scoring accuracy
2. Sanctions screening
3. KYC verification flow
4. Transaction monitoring

### Integration Tests
1. End-to-end compliance flow
2. Vendor API integration
3. Alert delivery
4. Audit logging

### Load Tests
1. High-volume screening
2. Concurrent verifications
3. Vendor rate limiting
4. Alert processing

## Performance Requirements

### Latency
- Address screening: < 500ms
- Transaction screening: < 1s
- KYC verification check: < 100ms
- Alert delivery: < 5s

### Throughput
- 1,000+ screenings per minute
- 100+ verifications per minute
- 10,000+ alert checks per minute

### Availability
- 99.9% uptime for compliance services
- Graceful degradation on vendor failures
- Fallback to cached risk scores

## Security Considerations

### Data Protection
- Encrypt sensitive data at rest
- Use TLS for all communications
- Implement access controls

### Vendor Security
- Secure API key storage
- Rotate keys regularly
- Monitor for unauthorized access

### Compliance Requirements
- GDPR compliance for EU users
- CCPA compliance for California users
- SOC 2 compliance for enterprise customers
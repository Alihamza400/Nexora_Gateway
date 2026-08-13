# Chain Abstraction Layer Skill

## Purpose
This skill defines the implementation guidelines for the Chain Abstraction Layer - the DRY boundary that normalizes all chain-specific logic behind unified interfaces.

## Core Responsibilities

### 1. Chain Normalization
- Provide unified interface for all chain interactions
- Abstract away chain-specific quirks (gas models, finality, address formats)
- Implement chain-specific logic exactly once per chain

### 2. Transaction Management
- Estimate gas/fees across chains
- Submit transactions with proper handling
- Track transaction status and confirmations

### 3. Deposit Monitoring
- Watch for incoming deposits across chains
- Detect confirmations and reorgs
- Emit events for the Payment Intent Service

## Data Model

### ChainClient
```typescript
interface IChainClient {
  chainId: string;
  chainName: string;
  
  // Chain Info
  getConfirmationDepth(): number;
  getBlockTime(): number;
  getNativeAsset(): AssetInfo;
  
  // Address Operations
  validateAddress(address: string): boolean;
  formatAddress(address: string): string;
  
  // Transaction Operations
  estimateGas(tx: UnsignedTx): Promise<GasEstimate>;
  submitTransaction(tx: SignedTx): Promise<TxResult>;
  getTransactionStatus(txHash: string): Promise<TxStatus>;
  getTransactionReceipt(txHash: string): Promise<TxReceipt>;
  
  // Balance Operations
  getBalance(address: string, asset: AssetInfo): Promise<Balance>;
  getTokenBalance(address: string, tokenAddress: string): Promise<Balance>;
  
  // Deposit Monitoring
  watchDeposits(
    address: string, 
    onDeposit: (tx: DepositEvent) => void
  ): Unsubscribe;
}

interface AssetInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

interface GasEstimate {
  gasLimit: number;
  gasPrice: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  totalCost: number;
  totalCostUSD: number;
}

interface TxResult {
  txHash: string;
  nonce?: number;
  blockNumber?: number;
}

interface TxStatus {
  txHash: string;
  status: 'PENDING' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED';
  confirmations: number;
  blockNumber?: number;
  gasUsed?: number;
  effectiveGasPrice?: number;
}

interface TxReceipt {
  txHash: string;
  status: boolean;
  blockNumber: number;
  blockHash: string;
  gasUsed: number;
  effectiveGasPrice: number;
  logs: TxLog[];
}

interface TxLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

interface Balance {
  asset: AssetInfo;
  amount: string;
  amountUSD: number;
}

interface DepositEvent {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  asset: AssetInfo;
  amount: string;
  confirmations: number;
}

type Unsubscribe = () => void;
```

## Chain Implementations

### EVM Chain Client
```typescript
class EVMChainClient implements IChainClient {
  constructor(
    private chainId: string,
    private chainName: string,
    private rpcUrl: string,
    private confirmationDepth: number,
    private blockTime: number
  ) {}

  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    const web3 = new Web3(this.rpcUrl);
    
    const gasLimit = await web3.eth.estimateGas({
      from: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data
    });

    const gasPrice = await web3.eth.getGasPrice();
    const block = await web3.eth.getBlock('latest');
    
    let maxFeePerGas: number | undefined;
    let maxPriorityFeePerGas: number | undefined;

    if (block.baseFeePerGas) {
      maxFeePerGas = BigInt(block.baseFeePerGas) * 2n;
      maxPriorityFeePerGas = BigInt(web3.utils.toWei('2', 'gwei'));
    }

    const totalCost = gasLimit * (maxFeePerGas || gasPrice);
    const totalCostUSD = await this.convertToUSD(totalCost, 'native');

    return {
      gasLimit: Number(gasLimit),
      gasPrice: Number(gasPrice),
      maxFeePerGas: maxFeePerGas ? Number(maxFeePerGas) : undefined,
      maxPriorityFeePerGas: maxPriorityFeePerGas ? Number(maxPriorityFeePerGas) : undefined,
      totalCost: Number(totalCost),
      totalCostUSD
    };
  }

  async submitTransaction(tx: SignedTx): Promise<TxResult> {
    const web3 = new Web3(this.rpcUrl);
    const result = await web3.eth.sendSignedTransaction(tx.signedData);
    
    return {
      txHash: result.transactionHash,
      nonce: result.nonce,
      blockNumber: result.blockNumber
    };
  }

  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    const web3 = new Web3(this.rpcUrl);
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    const currentBlock = await web3.eth.getBlockNumber();

    if (!receipt) {
      return {
        txHash,
        status: 'PENDING',
        confirmations: 0
      };
    }

    const confirmations = currentBlock - receipt.blockNumber;
    const status = receipt.status ? 'CONFIRMED' : 'FAILED';
    const confirming = confirmations < this.confirmationDepth;

    return {
      txHash,
      status: confirming ? 'CONFIRMING' : status,
      confirmations,
      blockNumber: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      effectiveGasPrice: Number(receipt.effectiveGasPrice)
    };
  }

  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void
  ): Unsubscribe {
    const web3 = new Web3(this.rpcUrl);
    let lastBlock = 0;

    const checkDeposits = async () => {
      const currentBlock = await web3.eth.getBlockNumber();
      
      for (let blockNum = lastBlock + 1; blockNum <= currentBlock; blockNum++) {
        const block = await web3.eth.getBlock(blockNum, true);
        
        for (const tx of block.transactions) {
          if (tx.to?.toLowerCase() === address.toLowerCase() ||
              tx.from?.toLowerCase() === address.toLowerCase()) {
            const receipt = await web3.eth.getTransactionReceipt(tx.hash!);
            
            if (receipt && receipt.status) {
              onDeposit({
                txHash: tx.hash!,
                blockNumber: blockNum,
                from: tx.from!,
                to: tx.to!,
                asset: this.getNativeAsset(),
                amount: tx.value.toString(),
                confirmations: currentBlock - blockNum
              });
            }
          }
        }
      }

      lastBlock = currentBlock;
    };

    const interval = setInterval(checkDeposits, this.blockTime * 1000);
    
    return () => clearInterval(interval);
  }

  // Helper methods
  private async convertToUSD(amount: number, asset: string): Promise<number> {
    // Implement price conversion
    return 0;
  }

  getNativeAsset(): AssetInfo {
    return {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      decimals: 18,
      name: 'Ether'
    };
  }

  validateAddress(address: string): boolean {
    return Web3.utils.isAddress(address);
  }

  formatAddress(address: string): string {
    return Web3.utils.toChecksumAddress(address);
  }

  getConfirmationDepth(): number {
    return this.confirmationDepth;
  }

  getBlockTime(): number {
    return this.blockTime;
  }

  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    const web3 = new Web3(this.rpcUrl);
    const amount = await web3.eth.getBalance(address);
    const amountUSD = await this.convertToUSD(Number(amount), asset.symbol);
    
    return {
      asset,
      amount: amount.toString(),
      amountUSD
    };
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<Balance> {
    const web3 = new Web3(this.rpcUrl);
    const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
    
    const [amount, decimals, symbol, name] = await Promise.all([
      contract.methods.balanceOf(address).call(),
      contract.methods.decimals().call(),
      contract.methods.symbol().call(),
      contract.methods.name().call()
    ]);

    const asset: AssetInfo = {
      address: tokenAddress,
      symbol,
      decimals: Number(decimals),
      name
    };

    const amountUSD = await this.convertToUSD(Number(amount), symbol);
    
    return {
      asset,
      amount: amount.toString(),
      amountUSD
    };
  }
}
```

### Tron Chain Client
```typescript
class TronChainClient implements IChainClient {
  constructor(
    private apiKey: string,
    private fullNode: string,
    private solidityNode: string
  ) {}

  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    const tronWeb = new TronWeb({
      fullHost: this.fullNode,
      solidityHost: this.solidityNode,
      headers: { 'TRON-PRO-API-KEY': this.apiKey }
    });

    // Tron uses energy/bandwidth model
    const energyNeeded = await this.estimateEnergy(tx);
    const bandwidthNeeded = await this.estimateBandwidth(tx);
    
    const energyPrice = await this.getEnergyPrice();
    const totalCost = energyNeeded * energyPrice;
    const totalCostUSD = await this.convertToUSD(totalCost, 'TRX');

    return {
      gasLimit: energyNeeded,
      gasPrice: energyPrice,
      totalCost,
      totalCostUSD
    };
  }

  async submitTransaction(tx: SignedTx): Promise<TxResult> {
    const tronWeb = new TronWeb({
      fullHost: this.fullNode,
      solidityHost: this.solidityNode,
      headers: { 'TRON-PRO-API-KEY': this.apiKey }
    });

    const result = await tronWeb.trx.sendRawTransaction(tx.signedData);
    
    return {
      txHash: result.txid
    };
  }

  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    const tronWeb = new TronWeb({
      fullHost: this.fullNode,
      solidityHost: this.solidityNode,
      headers: { 'TRON-PRO-API-KEY': this.apiKey }
    });

    const receipt = await tronWeb.trx.getTransactionInfo(txHash);
    const currentBlock = await tronWeb.trx.getCurrentBlock();

    if (!receipt) {
      return {
        txHash,
        status: 'PENDING',
        confirmations: 0
      };
    }

    const confirmations = currentBlock.block_header.raw_data.number - receipt.blockNumber;
    const status = receipt.receipt.result === 'SUCCESS' ? 'CONFIRMED' : 'FAILED';
    const confirming = confirmations < 19; // Tron finality

    return {
      txHash,
      status: confirming ? 'CONFIRMING' : status,
      confirmations,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.receipt.energy_usage_total,
      effectiveGasPrice: receipt.receipt.energy_penalty
    };
  }

  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void
  ): Unsubscribe {
    // Implement Tron deposit watching
    return () => {};
  }

  // Helper methods
  private async estimateEnergy(tx: UnsignedTx): Promise<number> {
    // Implement energy estimation
    return 0;
  }

  private async estimateBandwidth(tx: UnsignedTx): Promise<number> {
    // Implement bandwidth estimation
    return 0;
  }

  private async getEnergyPrice(): Promise<number> {
    // Implement energy price fetching
    return 0;
  }

  private async convertToUSD(amount: number, asset: string): Promise<number> {
    // Implement price conversion
    return 0;
  }

  getNativeAsset(): AssetInfo {
    return {
      address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
      symbol: 'TRX',
      decimals: 6,
      name: 'TRON'
    };
  }

  validateAddress(address: string): boolean {
    return TronWeb.isAddress(address);
  }

  formatAddress(address: string): string {
    return TronWeb.address.fromHex(address);
  }

  getConfirmationDepth(): number {
    return 19; // Tron finality
  }

  getBlockTime(): number {
    return 3; // 3 seconds
  }

  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    const tronWeb = new TronWeb({
      fullHost: this.fullNode,
      solidityHost: this.solidityNode,
      headers: { 'TRON-PRO-API-KEY': this.apiKey }
    });

    const balance = await tronWeb.trx.getBalance(address);
    const amountUSD = await this.convertToUSD(balance, asset.symbol);
    
    return {
      asset,
      amount: balance.toString(),
      amountUSD
    };
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<Balance> {
    const tronWeb = new TronWeb({
      fullHost: this.fullNode,
      solidityHost: this.solidityNode,
      headers: { 'TRON-PRO-API-KEY': this.apiKey }
    });

    const contract = await tronWeb.contract().at(tokenAddress);
    const [balance, decimals, symbol, name] = await Promise.all([
      contract.methods.balanceOf(address).call(),
      contract.methods.decimals().call(),
      contract.methods.symbol().call(),
      contract.methods.name().call()
    ]);

    const asset: AssetInfo = {
      address: tokenAddress,
      symbol,
      decimals: Number(decimals),
      name
    };

    const amountUSD = await this.convertToUSD(Number(balance), symbol);
    
    return {
      asset,
      amount: balance.toString(),
      amountUSD
    };
  }
}
```

### Solana Chain Client
```typescript
class SolanaChainClient implements IChainClient {
  constructor(
    private rpcUrl: string,
    private wsUrl: string,
    private confirmationDepth: number
  ) {}

  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    const connection = new Connection(this.rpcUrl);
    
    const transaction = new Transaction();
    // Add instructions to transaction
    
    const fee = await connection.getFeeForMessage(
      transaction.compileMessage()
    );

    const totalCost = fee.value;
    const totalCostUSD = await this.convertToUSD(totalCost, 'SOL');

    return {
      gasLimit: 200000, // Solana compute units
      gasPrice: 0.000005, // SOL per compute unit
      totalCost,
      totalCostUSD
    };
  }

  async submitTransaction(tx: SignedTx): Promise<TxResult> {
    const connection = new Connection(this.rpcUrl);
    
    const transaction = Transaction.from(tx.signedData);
    const signature = await connection.sendRawTransaction(
      tx.signedData
    );

    return {
      txHash: signature
    };
  }

  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    const connection = new Connection(this.rpcUrl);
    
    const status = await connection.getSignatureStatus(txHash);
    const currentSlot = await connection.getSlot();

    if (!status.value) {
      return {
        txHash,
        status: 'PENDING',
        confirmations: 0
      };
    }

    const confirmations = currentSlot - (status.value.slot || 0);
    const txStatus = status.value.err ? 'FAILED' : 'CONFIRMED';
    const confirming = confirmations < this.confirmationDepth;

    return {
      txHash,
      status: confirming ? 'CONFIRMING' : txStatus,
      confirmations,
      blockNumber: status.value.slot
    };
  }

  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void
  ): Unsubscribe {
    const connection = new Connection(this.rpcUrl, 'confirmed');
    
    const subscriptionId = connection.onLogs(
      address,
      (logs) => {
        logs.logs.forEach(log => {
          // Parse and emit deposit events
        });
      },
      'confirmed'
    );

    return () => {
      connection.removeOnLogsListener(subscriptionId);
    };
  }

  // Helper methods
  private async convertToUSD(amount: number, asset: string): Promise<number> {
    // Implement price conversion
    return 0;
  }

  getNativeAsset(): AssetInfo {
    return {
      address: '11111111111111111111111111111111',
      symbol: 'SOL',
      decimals: 9,
      name: 'Solana'
    };
  }

  validateAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  formatAddress(address: string): string {
    return new PublicKey(address).toBase58();
  }

  getConfirmationDepth(): number {
    return this.confirmationDepth;
  }

  getBlockTime(): number {
    return 0.4; // 400ms
  }

  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    const connection = new Connection(this.rpcUrl);
    const balance = await connection.getBalance(new PublicKey(address));
    const amountUSD = await this.convertToUSD(balance, asset.symbol);
    
    return {
      asset,
      amount: balance.toString(),
      amountUSD
    };
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<Balance> {
    const connection = new Connection(this.rpcUrl);
    
    const tokenAccount = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(address),
      { mint: new PublicKey(tokenAddress) }
    );

    if (tokenAccount.value.length === 0) {
      throw new Error('Token account not found');
    }

    const accountInfo = tokenAccount.value[0].account.data.parsed.info;
    const asset: AssetInfo = {
      address: tokenAddress,
      symbol: accountInfo.mint.symbol || 'UNKNOWN',
      decimals: accountInfo.mint.decimals,
      name: accountInfo.mint.name || 'Unknown Token'
    };

    const amountUSD = await this.convertToUSD(
      Number(accountInfo.tokenAmount.amount),
      asset.symbol
    );
    
    return {
      asset,
      amount: accountInfo.tokenAmount.amount,
      amountUSD
    };
  }
}
```

## Chain Registry

### ChainRegistry
```typescript
class ChainRegistry {
  private clients: Map<string, IChainClient> = new Map();

  register(client: IChainClient): void {
    this.clients.set(client.chainId, client);
  }

  get(chainId: string): IChainClient | undefined {
    return this.clients.get(chainId);
  }

  getAll(): IChainClient[] {
    return Array.from(this.clients.values());
  }

  getSupportedChains(): string[] {
    return Array.from(this.clients.keys());
  }

  getChainByName(name: string): IChainClient | undefined {
    return this.getAll().find(client => 
      client.chainName.toLowerCase() === name.toLowerCase()
    );
  }
}
```

## Gas Abstraction Integration

### GasAbstractionLayer
```typescript
class GasAbstractionLayer {
  constructor(
    private chainRegistry: ChainRegistry,
    private paymasterService: PaymasterService
  ) {}

  async estimateGasWithAbstraction(
    chainId: string,
    tx: UnsignedTx,
    customerAddress: string
  ): Promise<GasEstimate> {
    const chainClient = this.chainRegistry.get(chainId);
    if (!chainClient) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Check if chain supports account abstraction
    if (this.supportsAccountAbstraction(chainId)) {
      return this.estimateWithPaymaster(chainId, tx, customerAddress);
    } else {
      return this.estimateWithRelayer(chainId, tx, customerAddress);
    }
  }

  private async estimateWithPaymaster(
    chainId: string,
    tx: UnsignedTx,
    customerAddress: string
  ): Promise<GasEstimate> {
    // Use ERC-4337 paymaster
    return this.paymasterService.estimateUserOperation(tx, customerAddress);
  }

  private async estimateWithRelayer(
    chainId: string,
    tx: UnsignedTx,
    customerAddress: string
  ): Promise<GasEstimate> {
    // Use meta-transaction pattern
    const chainClient = this.chainRegistry.get(chainId)!;
    const baseEstimate = await chainClient.estimateGas(tx);
    
    // Add relayer fee
    const relayerFee = baseEstimate.totalCost * 0.1; // 10% relayer fee
    
    return {
      ...baseEstimate,
      totalCost: baseEstimate.totalCost + relayerFee,
      totalCostUSD: baseEstimate.totalCostUSD + (relayerFee * await this.getNativePrice(chainId))
    };
  }

  private supportsAccountAbstraction(chainId: string): boolean {
    const aaSupportedChains = ['1', '137', '42161', '10', '8453']; // Mainnet, Polygon, Arbitrum, Optimism, Base
    return aaSupportedChains.includes(chainId);
  }

  private async getNativePrice(chainId: string): Promise<number> {
    // Implement price fetching
    return 0;
  }
}
```

## Error Handling

### Error Types
```typescript
enum ChainClientError {
  UNSUPPORTED_CHAIN = 'UNSUPPORTED_CHAIN',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  RPC_ERROR = 'RPC_ERROR',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR'
}
```

### Error Recovery
```typescript
class ChainClientErrorRecovery {
  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
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
        
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
    
    throw lastError!;
  }

  private isNonRetryableError(error: any): boolean {
    const nonRetryableErrors = [
      ChainClientError.INVALID_ADDRESS,
      ChainClientError.INSUFFICIENT_BALANCE
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
1. Address validation across chains
2. Gas estimation accuracy
3. Transaction status tracking
4. Balance fetching

### Integration Tests
1. End-to-end deposit detection
2. Transaction submission and confirmation
3. Multi-chain operations
4. Error recovery scenarios

### Load Tests
1. Concurrent deposit monitoring
2. High-volume transaction submission
3. RPC rate limiting
4. Memory usage under load

## Performance Requirements

### Latency
- Address validation: < 1ms
- Gas estimation: < 500ms
- Transaction submission: < 1s
- Status check: < 200ms

### Throughput
- 10,000+ address validations per second
- 1,000+ gas estimations per minute
- 100+ transaction submissions per minute

### Reliability
- 99.99% uptime for chain clients
- Automatic failover to backup RPCs
- Graceful degradation on network issues
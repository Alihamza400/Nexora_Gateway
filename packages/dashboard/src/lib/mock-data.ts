// ─── Payment Flow Data ───────────────────────────────────────────────────────

export const paymentFlowMetrics = {
  intentsCreated: 12847,
  intentsSettled: 11923,
  successRate: 92.8,
  avgSettlementTime: 42,
  totalVolume: 2847593,
  activeIntents: 924,
};

export const paymentFlowTimeSeries = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i.toString().padStart(2, '0')}:00`,
  created: Math.floor(Math.random() * 800) + 400,
  settled: Math.floor(Math.random() * 700) + 350,
  failed: Math.floor(Math.random() * 50) + 10,
}));

export const paymentFlowByChain = [
  { name: 'Ethereum', value: 4230, color: '#627EEA' },
  { name: 'Base', value: 3120, color: '#0052FF' },
  { name: 'Arbitrum', value: 2890, color: '#28A0F0' },
  { name: 'Polygon', value: 1580, color: '#8247E5' },
  { name: 'Tron', value: 680, color: '#FF0013' },
  { name: 'Solana', value: 347, color: '#9945FF' },
];

export const paymentFlowByStatus = [
  { name: 'Settled', value: 11923, color: '#10b981' },
  { name: 'Pending', value: 524, color: '#f59e0b' },
  { name: 'Expired', value: 218, color: '#f97316' },
  { name: 'Failed', value: 182, color: '#ef4444' },
];

// ─── Settlement Data ─────────────────────────────────────────────────────────

export const settlementMetrics = {
  totalVolume: 2847593,
  successRate: 98.2,
  avgLatency: 3.2,
  pendingSettlements: 47,
  settledToday: 1247,
  failedToday: 12,
};

export const settlementTimeSeries = Array.from({ length: 30 }, (_, i) => ({
  date: `Aug ${i + 1}`,
  volume: Math.floor(Math.random() * 200000) + 80000,
  settlements: Math.floor(Math.random() * 500) + 200,
  latency: Math.floor(Math.random() * 5) + 1,
}));

export const settlementByAsset = [
  { name: 'USDC', value: 1523400, color: '#2775CA' },
  { name: 'USDT', value: 987200, color: '#26A17B' },
  { name: 'ETH', value: 234500, color: '#627EEA' },
  { name: 'DAI', value: 102493, color: '#F5AC37' },
];

// ─── Recovery Data ───────────────────────────────────────────────────────────

export const recoveryMetrics = {
  totalCases: 347,
  resolvedCases: 312,
  resolutionRate: 89.9,
  avgResolutionTime: 4.2,
  pendingCases: 23,
  escalatedCases: 12,
};

export const recoveryTimeSeries = Array.from({ length: 30 }, (_, i) => ({
  date: `Aug ${i + 1}`,
  cases: Math.floor(Math.random() * 20) + 5,
  resolved: Math.floor(Math.random() * 18) + 3,
}));

export const recoveryByType = [
  { name: 'Underpaid', value: 124, color: '#f59e0b' },
  { name: 'Overpaid', value: 89, color: '#3b82f6' },
  { name: 'Misdirected', value: 67, color: '#ef4444' },
  { name: 'Stuck Tx', value: 43, color: '#8b5cf6' },
  { name: 'Wrong Chain', value: 24, color: '#f97316' },
];

// ─── Infrastructure Data ─────────────────────────────────────────────────────

export const infrastructureMetrics = {
  cpuUsage: 67.3,
  memoryUsage: 72.1,
  diskUsage: 45.8,
  networkIn: 234.5,
  networkOut: 189.2,
  activeConnections: 1247,
};

export const infrastructureTimeSeries = Array.from({ length: 60 }, (_, i) => ({
  time: `${i}m ago`,
  cpu: Math.floor(Math.random() * 30) + 55,
  memory: Math.floor(Math.random() * 15) + 65,
  disk: Math.floor(Math.random() * 5) + 43,
  networkIn: Math.floor(Math.random() * 100) + 180,
  networkOut: Math.floor(Math.random() * 80) + 150,
}));

// ─── Blockchain Data ─────────────────────────────────────────────────────────

export const blockchainMetrics = {
  ethGasPrice: 12.4,
  baseGasPrice: 0.08,
  arbitrumGasPrice: 0.12,
  avgConfirmationTime: 3.2,
  totalFeesCollected: 12450,
  activeWatchers: 6,
};

export const gasPriceTimeSeries = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i.toString().padStart(2, '0')}:00`,
  ethereum: Math.floor(Math.random() * 20) + 8,
  base: Math.floor(Math.random() * 0.15 * 100) / 100 + 0.03,
  arbitrum: Math.floor(Math.random() * 0.2 * 100) / 100 + 0.05,
  polygon: Math.floor(Math.random() * 0.01 * 100) / 100 + 0.005,
}));

export const confirmationTimeByChain = [
  { chain: 'Ethereum', time: 12.4, confirmations: 12 },
  { chain: 'Base', time: 2.1, confirmations: 1 },
  { chain: 'Arbitrum', time: 1.8, confirmations: 1 },
  { chain: 'Polygon', time: 2.4, confirmations: 128 },
  { chain: 'Tron', time: 3.0, confirmations: 19 },
  { chain: 'Solana', time: 0.4, confirmations: 32 },
];

export const feeCollectionTimeSeries = Array.from({ length: 30 }, (_, i) => ({
  date: `Aug ${i + 1}`,
  gasFees: Math.floor(Math.random() * 300) + 100,
  bridgeFees: Math.floor(Math.random() * 500) + 200,
  relayerFees: Math.floor(Math.random() * 200) + 80,
}));

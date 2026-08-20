import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { AreaChart } from '@/components/charts/area-chart';
import {
  blockchainMetrics,
  gasPriceTimeSeries,
  confirmationTimeByChain,
  feeCollectionTimeSeries,
} from '@/lib/mock-data';
import { formatCurrency, formatLatency } from '@/lib/utils';
import {
  Fuel,
  Clock,
  DollarSign,
  Eye,
} from 'lucide-react';

export default function BlockchainPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Blockchain</h1>
        <p className="text-muted-foreground">
          Monitor gas prices, confirmation times, and chain health
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="ETH Gas Price"
          value={`${blockchainMetrics.ethGasPrice} gwei`}
          description="Ethereum L1"
          icon={Fuel}
        />
        <MetricCard
          title="Avg Confirmation"
          value={formatLatency(blockchainMetrics.avgConfirmationTime * 1000)}
          description="Across all chains"
          icon={Clock}
        />
        <MetricCard
          title="Fees Collected"
          value={formatCurrency(blockchainMetrics.totalFeesCollected)}
          description="Last 30 days"
          icon={DollarSign}
          trend={{ value: 8.4, isPositive: true }}
        />
        <MetricCard
          title="Active Watchers"
          value={blockchainMetrics.activeWatchers}
          description="Chain monitoring"
          icon={Eye}
        />
      </div>

      {/* Gas Prices Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Gas Prices by Chain (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            data={gasPriceTimeSeries}
            xKey="hour"
            lines={[
              { key: 'ethereum', color: '#627EEA', name: 'Ethereum (gwei)' },
              { key: 'base', color: '#0052FF', name: 'Base (gwei)' },
              { key: 'arbitrum', color: '#28A0F0', name: 'Arbitrum (gwei)' },
              { key: 'polygon', color: '#8247E5', name: 'Polygon (gwei)' },
            ]}
            height={350}
          />
        </CardContent>
      </Card>

      {/* Confirmation Times & Fee Collection */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Confirmation Times by Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={confirmationTimeByChain}
              xKey="chain"
              bars={[
                { key: 'time', color: '#3b82f6', name: 'Time (seconds)' },
              ]}
              height={300}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fee Collection (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={feeCollectionTimeSeries}
              xKey="date"
              areas={[
                { key: 'gasFees', color: '#3b82f6', name: 'Gas Fees', stackId: 'fees' },
                { key: 'bridgeFees', color: '#10b981', name: 'Bridge Fees', stackId: 'fees' },
                { key: 'relayerFees', color: '#f59e0b', name: 'Relayer Fees', stackId: 'fees' },
              ]}
              height={300}
            />
          </CardContent>
        </Card>
      </div>

      {/* Chain Health Table */}
      <Card>
        <CardHeader>
          <CardTitle>Chain Health Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-3 text-left font-medium text-muted-foreground">Chain</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Network</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Gas Price</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Block Time</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Confirmations</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Finality</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { chain: 'Ethereum', network: 'L1', gas: '12.4 gwei', blockTime: '~12s', confirmations: 12, finality: '~18 min', status: 'Healthy' },
                  { chain: 'Base', network: 'L2 Rollup', gas: '0.08 gwei', blockTime: '~2s', confirmations: 1, finality: '~2s', status: 'Healthy' },
                  { chain: 'Arbitrum', network: 'L2 Rollup', gas: '0.12 gwei', blockTime: '~0.25s', confirmations: 1, finality: '~1s', status: 'Healthy' },
                  { chain: 'Polygon', network: 'L2 Sidechain', gas: '30 gwei', blockTime: '~2s', confirmations: 128, finality: '~5 min', status: 'Healthy' },
                  { chain: 'Tron', network: 'L1', gas: 'TRX Energy', blockTime: '~3s', confirmations: 19, finality: '~57s', status: 'Healthy' },
                  { chain: 'Solana', network: 'L1', gas: '0.000005 SOL', blockTime: '~400ms', confirmations: 32, finality: '~13s', status: 'Healthy' },
                ].map((chain) => (
                  <tr key={chain.chain} className="border-b last:border-0">
                    <td className="py-3 font-medium">{chain.chain}</td>
                    <td className="py-3 text-muted-foreground">{chain.network}</td>
                    <td className="py-3 text-right">{chain.gas}</td>
                    <td className="py-3 text-right text-muted-foreground">{chain.blockTime}</td>
                    <td className="py-3 text-right text-muted-foreground">{chain.confirmations}</td>
                    <td className="py-3 text-right text-muted-foreground">{chain.finality}</td>
                    <td className="py-3 text-right">
                      <span className="rounded-full px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800">
                        {chain.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

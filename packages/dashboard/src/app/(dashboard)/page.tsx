import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { PieChart } from '@/components/charts/pie-chart';
import {
  paymentFlowMetrics,
  paymentFlowTimeSeries,
  paymentFlowByChain,
  settlementMetrics,
  recoveryMetrics,
  blockchainMetrics,
} from '@/lib/mock-data';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';
import {
  CreditCard,
  Activity,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
        <p className="text-muted-foreground">
          Real-time metrics across your crypto payment gateway
        </p>
      </div>

      {/* Top Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Volume"
          value={formatCurrency(paymentFlowMetrics.totalVolume)}
          description="All-time settled volume"
          icon={TrendingUp}
          trend={{ value: 12.5, isPositive: true }}
        />
        <MetricCard
          title="Intents Created"
          value={formatNumber(paymentFlowMetrics.intentsCreated)}
          description="Last 24 hours"
          icon={CreditCard}
          trend={{ value: 8.2, isPositive: true }}
        />
        <MetricCard
          title="Success Rate"
          value={formatPercent(paymentFlowMetrics.successRate)}
          description="Payment success rate"
          icon={Activity}
          trend={{ value: 1.3, isPositive: true }}
        />
        <MetricCard
          title="Recovery Cases"
          value={recoveryMetrics.totalCases}
          description={`${recoveryMetrics.resolutionRate}% resolved`}
          icon={RotateCcw}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Payment Flow Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Payment Flow (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={paymentFlowTimeSeries}
              xKey="hour"
              areas={[
                { key: 'created', color: '#3b82f6', name: 'Created' },
                { key: 'settled', color: '#10b981', name: 'Settled' },
                { key: 'failed', color: '#ef4444', name: 'Failed' },
              ]}
              height={280}
            />
          </CardContent>
        </Card>

        {/* Chain Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>By Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={paymentFlowByChain} height={280} />
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Settlement Status */}
        <Card>
          <CardHeader>
            <CardTitle>Settlement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Today&apos;s Volume</span>
              <span className="font-medium">{formatCurrency(settlementMetrics.totalVolume * 0.05)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Success Rate</span>
              <span className="font-medium text-emerald-600">{formatPercent(settlementMetrics.successRate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg Latency</span>
              <span className="font-medium">{settlementMetrics.avgLatency}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Pending</span>
              <span className="font-medium">{settlementMetrics.pendingSettlements}</span>
            </div>
          </CardContent>
        </Card>

        {/* Recovery Status */}
        <Card>
          <CardHeader>
            <CardTitle>Recovery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Cases</span>
              <span className="font-medium">{recoveryMetrics.totalCases}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Resolution Rate</span>
              <span className="font-medium text-emerald-600">{formatPercent(recoveryMetrics.resolutionRate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Pending</span>
              <span className="font-medium text-amber-600">{recoveryMetrics.pendingCases}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Escalated</span>
              <span className="font-medium text-red-600">{recoveryMetrics.escalatedCases}</span>
            </div>
          </CardContent>
        </Card>

        {/* Blockchain Status */}
        <Card>
          <CardHeader>
            <CardTitle>Blockchain Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">ETH Gas</span>
              <span className="font-medium">{blockchainMetrics.ethGasPrice} gwei</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Base Gas</span>
              <span className="font-medium">{blockchainMetrics.baseGasPrice} gwei</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg Confirmation</span>
              <span className="font-medium">{blockchainMetrics.avgConfirmationTime}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Active Watchers</span>
              <span className="font-medium">{blockchainMetrics.activeWatchers}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

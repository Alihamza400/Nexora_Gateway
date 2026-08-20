import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { PieChart } from '@/components/charts/pie-chart';
import { LineChart } from '@/components/charts/line-chart';
import {
  settlementMetrics,
  settlementTimeSeries,
  settlementByAsset,
} from '@/lib/mock-data';
import { formatCurrency, formatPercent, formatLatency } from '@/lib/utils';
import {
  DollarSign,
  CheckCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';

export default function SettlementPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settlement</h1>
        <p className="text-muted-foreground">
          Track settlement volume, success rates, and processing latency
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Volume"
          value={formatCurrency(settlementMetrics.totalVolume)}
          description="All-time settled"
          icon={DollarSign}
          trend={{ value: 15.3, isPositive: true }}
        />
        <MetricCard
          title="Success Rate"
          value={formatPercent(settlementMetrics.successRate)}
          description="Settlement success"
          icon={CheckCircle}
          trend={{ value: 0.8, isPositive: true }}
        />
        <MetricCard
          title="Avg Latency"
          value={formatLatency(settlementMetrics.avgLatency * 1000)}
          description="Processing time"
          icon={Clock}
        />
        <MetricCard
          title="Failed Today"
          value={settlementMetrics.failedToday}
          description={`${settlementMetrics.settledToday} settled`}
          icon={AlertTriangle}
        />
      </div>

      {/* Pending Settlements Alert */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="flex items-center gap-4 p-4">
          <Clock className="h-8 w-8 text-blue-600" />
          <div>
            <p className="font-semibold text-blue-900">
              {settlementMetrics.pendingSettlements} Pending Settlements
            </p>
            <p className="text-sm text-blue-700">
              Awaiting confirmation or processing across settlement chains
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Volume Chart */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Settlement Volume (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={settlementTimeSeries}
              xKey="date"
              areas={[
                { key: 'volume', color: '#3b82f6', name: 'Volume (USD)' },
              ]}
              height={320}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By Asset</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={settlementByAsset} height={320} />
          </CardContent>
        </Card>
      </div>

      {/* Latency & Settlements */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Settlement Latency (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              data={settlementTimeSeries}
              xKey="date"
              lines={[
                { key: 'latency', color: '#f59e0b', name: 'Latency (seconds)' },
              ]}
              height={280}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settlements Per Day (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={settlementTimeSeries}
              xKey="date"
              bars={[
                { key: 'settlements', color: '#10b981', name: 'Settlements' },
              ]}
              height={280}
            />
          </CardContent>
        </Card>
      </div>

      {/* Recent Settlements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Settlements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Chain</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Asset</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Latency</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { id: 'STL-447', chain: 'Base', asset: 'USDC', amount: '$4,250.00', latency: '1.8s', status: 'Settled' },
                  { id: 'STL-446', chain: 'Ethereum', asset: 'USDT', amount: '$12,800.00', latency: '12.4s', status: 'Settled' },
                  { id: 'STL-445', chain: 'Arbitrum', asset: 'USDC', amount: '$890.00', latency: '2.1s', status: 'Settled' },
                  { id: 'STL-444', chain: 'Polygon', asset: 'USDC', amount: '$3,200.00', latency: '3.2s', status: 'Processing' },
                  { id: 'STL-443', chain: 'Base', asset: 'ETH', amount: '$8,400.00', latency: '2.4s', status: 'Settled' },
                  { id: 'STL-442', chain: 'Tron', asset: 'USDT', amount: '$560.00', latency: '4.8s', status: 'Settled' },
                ].map((settlement) => (
                  <tr key={settlement.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">{settlement.id}</td>
                    <td className="py-3">{settlement.chain}</td>
                    <td className="py-3">{settlement.asset}</td>
                    <td className="py-3 text-right font-medium">{settlement.amount}</td>
                    <td className="py-3 text-right text-muted-foreground">{settlement.latency}</td>
                    <td className="py-3 text-right">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          settlement.status === 'Settled'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {settlement.status}
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

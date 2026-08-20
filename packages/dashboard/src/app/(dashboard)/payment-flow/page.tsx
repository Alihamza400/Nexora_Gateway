import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { PieChart } from '@/components/charts/pie-chart';
import {
  paymentFlowMetrics,
  paymentFlowTimeSeries,
  paymentFlowByChain,
  paymentFlowByStatus,
} from '@/lib/mock-data';
import { formatNumber, formatPercent, formatLatency } from '@/lib/utils';
import {
  CreditCard,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
} from 'lucide-react';

export default function PaymentFlowPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payment Flow</h1>
        <p className="text-muted-foreground">
          Monitor payment intents, success rates, and transaction volumes
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Intents Created"
          value={formatNumber(paymentFlowMetrics.intentsCreated)}
          description="Total payment intents"
          icon={CreditCard}
          trend={{ value: 12.5, isPositive: true }}
        />
        <MetricCard
          title="Intents Settled"
          value={formatNumber(paymentFlowMetrics.intentsSettled)}
          description="Successfully completed"
          icon={CheckCircle}
          trend={{ value: 8.2, isPositive: true }}
        />
        <MetricCard
          title="Success Rate"
          value={formatPercent(paymentFlowMetrics.successRate)}
          description="Settlement success"
          icon={TrendingUp}
          trend={{ value: 1.3, isPositive: true }}
        />
        <MetricCard
          title="Avg Settlement Time"
          value={formatLatency(paymentFlowMetrics.avgSettlementTime * 1000)}
          description="End-to-end latency"
          icon={Clock}
        />
      </div>

      {/* Active Intents Banner */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-center gap-4 p-4">
          <Users className="h-8 w-8 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">
              {formatNumber(paymentFlowMetrics.activeIntents)} Active Intents
            </p>
            <p className="text-sm text-amber-700">
              Currently awaiting payment or confirmation across all chains
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment Flow Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Intents Created vs Settled (24h)</CardTitle>
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
              height={320}
            />
          </CardContent>
        </Card>

        {/* Volume by Chain */}
        <Card>
          <CardHeader>
            <CardTitle>Intents by Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={paymentFlowByChain}
              xKey="name"
              bars={[
                {
                  key: 'value',
                  name: 'Intents',
                },
              ]}
              height={320}
            />
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={paymentFlowByStatus} height={280} />
          </CardContent>
        </Card>

        {/* Recent Activity Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Intents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { id: 'INT-8847', chain: 'Base', amount: '$150.00', status: 'Settled', time: '2m ago' },
                { id: 'INT-8846', chain: 'Ethereum', amount: '$2,400.00', status: 'Confirming', time: '5m ago' },
                { id: 'INT-8845', chain: 'Arbitrum', amount: '$89.50', status: 'Settled', time: '8m ago' },
                { id: 'INT-8844', chain: 'Polygon', amount: '$320.00', status: 'Pending', time: '12m ago' },
                { id: 'INT-8843', chain: 'Tron', amount: '$45.00', status: 'Settled', time: '15m ago' },
                { id: 'INT-8842', chain: 'Base', amount: '$1,200.00', status: 'Failed', time: '18m ago' },
              ].map((intent) => (
                <div key={intent.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{intent.id}</p>
                      <p className="text-xs text-muted-foreground">{intent.chain}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{intent.amount}</p>
                    <p className="text-xs text-muted-foreground">{intent.time}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      intent.status === 'Settled'
                        ? 'bg-emerald-100 text-emerald-800'
                        : intent.status === 'Failed'
                          ? 'bg-red-100 text-red-800'
                          : intent.status === 'Confirming'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {intent.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

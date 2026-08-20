import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { PieChart } from '@/components/charts/pie-chart';
import {
  recoveryMetrics,
  recoveryTimeSeries,
  recoveryByType,
} from '@/lib/mock-data';
import { formatNumber, formatPercent, formatLatency } from '@/lib/utils';
import {
  RotateCcw,
  CheckCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';

export default function RecoveryPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Recovery</h1>
        <p className="text-muted-foreground">
          Monitor recovery cases, resolution rates, and automated fixes
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Cases"
          value={formatNumber(recoveryMetrics.totalCases)}
          description="All-time recovery cases"
          icon={RotateCcw}
          trend={{ value: 5.2, isPositive: false }}
        />
        <MetricCard
          title="Resolution Rate"
          value={formatPercent(recoveryMetrics.resolutionRate)}
          description="Successfully resolved"
          icon={CheckCircle}
          trend={{ value: 2.1, isPositive: true }}
        />
        <MetricCard
          title="Avg Resolution Time"
          value={formatLatency(recoveryMetrics.avgResolutionTime * 60 * 1000)}
          description="Time to resolve"
          icon={Clock}
        />
        <MetricCard
          title="Escalated"
          value={recoveryMetrics.escalatedCases}
          description="Requires manual review"
          icon={AlertTriangle}
        />
      </div>

      {/* Pending Cases Alert */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-center gap-4 p-4">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">
              {recoveryMetrics.pendingCases} Pending Cases
            </p>
            <p className="text-sm text-amber-700">
              Awaiting resolution or manual review by the operations team
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cases Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Cases Created vs Resolved (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={recoveryTimeSeries}
              xKey="date"
              areas={[
                { key: 'cases', color: '#f59e0b', name: 'Created' },
                { key: 'resolved', color: '#10b981', name: 'Resolved' },
              ]}
              height={320}
            />
          </CardContent>
        </Card>

        {/* Cases by Type */}
        <Card>
          <CardHeader>
            <CardTitle>Cases by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={recoveryByType} height={320} />
          </CardContent>
        </Card>
      </div>

      {/* Recovery Cases Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Recovery Cases</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-3 text-left font-medium text-muted-foreground">Case ID</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Type</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Intent</th>
                  <th className="pb-3 text-left font-medium text-muted-foreground">Chain</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="pb-3 text-right font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { id: 'RCV-112', type: 'Underpaid', intent: 'INT-8801', chain: 'Base', amount: '$45.20', status: 'Resolved' },
                  { id: 'RCV-111', type: 'Overpaid', intent: 'INT-8799', chain: 'Ethereum', amount: '$320.00', status: 'Resolved' },
                  { id: 'RCV-110', type: 'Misdirected', intent: 'INT-8795', chain: 'Polygon', amount: '$1,200.00', status: 'Pending' },
                  { id: 'RCV-109', type: 'Stuck Tx', intent: 'INT-8790', chain: 'Tron', amount: '$89.00', status: 'Escalated' },
                  { id: 'RCV-108', type: 'Wrong Chain', intent: 'INT-8785', chain: 'Arbitrum', amount: '$560.00', status: 'Resolved' },
                  { id: 'RCV-107', type: 'Underpaid', intent: 'INT-8780', chain: 'Base', amount: '$23.50', status: 'Resolved' },
                ].map((rc) => (
                  <tr key={rc.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">{rc.id}</td>
                    <td className="py-3">
                      <span className="rounded-full px-2 py-1 text-xs font-medium bg-slate-100 text-slate-800">
                        {rc.type}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground">{rc.intent}</td>
                    <td className="py-3">{rc.chain}</td>
                    <td className="py-3 text-right font-medium">{rc.amount}</td>
                    <td className="py-3 text-right">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          rc.status === 'Resolved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : rc.status === 'Escalated'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {rc.status}
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

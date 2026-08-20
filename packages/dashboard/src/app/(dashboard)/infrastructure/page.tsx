'use client';

import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { AreaChart } from '@/components/charts/area-chart';
import {
  infrastructureMetrics,
  infrastructureTimeSeries,
} from '@/lib/mock-data';
import { formatNumber } from '@/lib/utils';
import {
  Cpu,
  HardDrive,
  Server,
  Globe,
} from 'lucide-react';

function UsageGauge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function InfrastructurePage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Infrastructure</h1>
        <p className="text-muted-foreground">
          Monitor system health, resource usage, and network performance
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="CPU Usage"
          value={`${infrastructureMetrics.cpuUsage}%`}
          description="Average across nodes"
          icon={Cpu}
        />
        <MetricCard
          title="Memory Usage"
          value={`${infrastructureMetrics.memoryUsage}%`}
          description="Heap utilization"
          icon={Server}
        />
        <MetricCard
          title="Disk Usage"
          value={`${infrastructureMetrics.diskUsage}%`}
          description="Storage utilization"
          icon={HardDrive}
        />
        <MetricCard
          title="Active Connections"
          value={formatNumber(infrastructureMetrics.activeConnections)}
          description="WebSocket + HTTP"
          icon={Globe}
        />
      </div>

      {/* Resource Gauges */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>CPU</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageGauge
              label="Usage"
              value={infrastructureMetrics.cpuUsage}
              color={infrastructureMetrics.cpuUsage > 80 ? '#ef4444' : infrastructureMetrics.cpuUsage > 60 ? '#f59e0b' : '#10b981'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Memory</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageGauge
              label="Usage"
              value={infrastructureMetrics.memoryUsage}
              color={infrastructureMetrics.memoryUsage > 80 ? '#ef4444' : infrastructureMetrics.memoryUsage > 60 ? '#f59e0b' : '#10b981'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Disk</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageGauge
              label="Usage"
              value={infrastructureMetrics.diskUsage}
              color={infrastructureMetrics.diskUsage > 80 ? '#ef4444' : infrastructureMetrics.diskUsage > 60 ? '#f59e0b' : '#10b981'}
            />
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* CPU & Memory Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>CPU & Memory (60m)</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              data={infrastructureTimeSeries}
              xKey="time"
              lines={[
                { key: 'cpu', color: '#3b82f6', name: 'CPU %' },
                { key: 'memory', color: '#8b5cf6', name: 'Memory %' },
              ]}
              height={300}
            />
          </CardContent>
        </Card>

        {/* Network Traffic */}
        <Card>
          <CardHeader>
            <CardTitle>Network Traffic (60m)</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={infrastructureTimeSeries}
              xKey="time"
              areas={[
                { key: 'networkIn', color: '#10b981', name: 'Inbound (MB/s)' },
                { key: 'networkOut', color: '#f59e0b', name: 'Outbound (MB/s)' },
              ]}
              height={300}
            />
          </CardContent>
        </Card>
      </div>

      {/* Service Status */}
      <Card>
        <CardHeader>
          <CardTitle>Service Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: 'API Gateway', status: 'Healthy', uptime: '99.99%', latency: '12ms' },
              { name: 'Payment Intent Service', status: 'Healthy', uptime: '99.99%', latency: '24ms' },
              { name: 'Routing Engine', status: 'Healthy', uptime: '99.98%', latency: '156ms' },
              { name: 'Gas Abstraction', status: 'Healthy', uptime: '99.99%', latency: '89ms' },
              { name: 'Settlement Service', status: 'Healthy', uptime: '99.97%', latency: '2.4s' },
              { name: 'Recovery Service', status: 'Degraded', uptime: '99.90%', latency: '340ms' },
              { name: 'Chain Watchers', status: 'Healthy', uptime: '99.99%', latency: '45ms' },
              { name: 'Reconciliation', status: 'Healthy', uptime: '99.99%', latency: '67ms' },
            ].map((service) => (
              <div key={service.name} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      service.status === 'Healthy'
                        ? 'bg-emerald-500'
                        : service.status === 'Degraded'
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    }`}
                  />
                  <span className="font-medium">{service.name}</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-muted-foreground">Uptime: {service.uptime}</span>
                  <span className="text-muted-foreground">Latency: {service.latency}</span>
                  <span
                    className={`font-medium ${
                      service.status === 'Healthy'
                        ? 'text-emerald-600'
                        : service.status === 'Degraded'
                          ? 'text-amber-600'
                          : 'text-red-600'
                    }`}
                  >
                    {service.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

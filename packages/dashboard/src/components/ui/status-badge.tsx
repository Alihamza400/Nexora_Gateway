import { Badge } from '@/components/ui/badge';

interface StatusBadgeProps {
  status: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  settled: 'success',
  success: 'success',
  resolved: 'success',
  healthy: 'success',
  pending: 'warning',
  confirming: 'warning',
  awaiting: 'warning',
  detecting: 'warning',
  routing: 'warning',
  settling: 'warning',
  degraded: 'warning',
  failed: 'error',
  error: 'error',
  critical: 'error',
  expired: 'error',
  misdirected: 'error',
  refunding: 'warning',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const variant = STATUS_VARIANTS[status.toLowerCase()] || 'default';

  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

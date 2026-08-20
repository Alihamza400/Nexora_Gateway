import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'settled':
    case 'success':
    case 'resolved':
    case 'healthy':
      return 'text-emerald-600 bg-emerald-50';
    case 'pending':
    case 'confirming':
    case 'awaiting':
    case 'degraded':
      return 'text-amber-600 bg-amber-50';
    case 'failed':
    case 'error':
    case 'critical':
      return 'text-red-600 bg-red-50';
    case 'expired':
    case 'refunding':
      return 'text-orange-600 bg-orange-50';
    default:
      return 'text-slate-600 bg-slate-50';
  }
}

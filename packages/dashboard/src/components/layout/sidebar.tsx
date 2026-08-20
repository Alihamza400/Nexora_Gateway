'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Activity,
  CreditCard,
  RotateCcw,
  Server,
  Link2,
  LayoutDashboard,
  UserPlus,
  LogIn,
  Store,
  Wallet,
} from 'lucide-react';

const merchantNavigation = [
  {
    name: 'Overview',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    name: 'Payment Flow',
    href: '/payment-flow',
    icon: CreditCard,
  },
  {
    name: 'Settlement',
    href: '/settlement',
    icon: Activity,
  },
  {
    name: 'Recovery',
    href: '/recovery',
    icon: RotateCcw,
  },
  {
    name: 'Infrastructure',
    href: '/infrastructure',
    icon: Server,
  },
  {
    name: 'Blockchain',
    href: '/blockchain',
    icon: Link2,
  },
];

const merchantPages = [
  {
    name: 'Register',
    href: '/register',
    icon: UserPlus,
  },
  {
    name: 'Login',
    href: '/login',
    icon: LogIn,
  },
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: Store,
  },
  {
    name: 'Payment Demo',
    href: '/pay/demo',
    icon: Wallet,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            CG
          </div>
          <div>
            <p className="text-sm font-semibold">Crypto Gateway</p>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
        </Link>
      </div>

      {/* Merchant Pages */}
      <nav className="p-4 pb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
          Merchant
        </p>
        <div className="space-y-1">
          {merchantPages.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Operations */}
      <nav className="flex-1 p-4 pt-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
          Operations
        </p>
        <div className="space-y-1">
          {merchantNavigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs text-muted-foreground">System Operational</span>
        </div>
      </div>
    </div>
  );
}

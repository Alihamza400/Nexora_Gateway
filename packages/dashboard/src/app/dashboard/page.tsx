'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, intentsApi, type IntentListItem, type ProfileResponse } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Key, Copy, RefreshCw, ExternalLink, CreditCard, Clock, CheckCircle } from 'lucide-react';

export default function MerchantDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResponse['data'] | null>(null);
  const [intents, setIntents] = useState<IntentListItem[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('cg_token') : null;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const loadData = useCallback(async () => {
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      const [profileRes, intentsRes] = await Promise.all([
        authApi.getProfile(token),
        intentsApi.list(token),
      ]);
      setProfile(profileRes.data);
      setIntents(intentsRes.intents);

      const storedKey = localStorage.getItem('cg_api_key') || '';
      setApiKey(storedKey);
    } catch {
      setError('Session expired. Please log in again.');
      localStorage.removeItem('cg_token');
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [token, router]);

  useEffect(() => {
    void loadData();
  }, [loadData]); // eslint-disable-line @typescript-eslint/no-floating-promises

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateKey = async () => {
    if (!apiKey) return;
    setRegenerating(true);
    try {
      const result = await authApi.regenerateKey(apiKey);
      setApiKey(result.data.api_key);
      localStorage.setItem('cg_api_key', result.data.api_key);
    } catch {
      setError('Failed to regenerate API key');
    } finally {
      setRegenerating(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('cg_token');
    localStorage.removeItem('cg_api_key');
    localStorage.removeItem('cg_merchant_id');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  const stateCounts: Record<string, number> = {};
  for (const intent of intents) {
    stateCounts[intent.state] = (stateCounts[intent.state] || 0) + 1;
  }

  const getStateBadge = (state: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-blue-100 text-blue-800',
      QUOTED: 'bg-purple-100 text-purple-800',
      AWAITING_PAYMENT: 'bg-amber-100 text-amber-800',
      DETECTED: 'bg-cyan-100 text-cyan-800',
      CONFIRMING: 'bg-blue-100 text-blue-800',
      ROUTING: 'bg-indigo-100 text-indigo-800',
      SETTLING: 'bg-orange-100 text-orange-800',
      SETTLED: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
    };
    return colors[state] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchant Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {profile?.name || 'Merchant'}
          </p>
        </div>
        <button
          onClick={logout}
          className="text-sm text-muted-foreground hover:text-foreground border rounded-lg px-4 py-2"
        >
          Sign Out
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Total Intents"
          value={intents.length}
          icon={CreditCard}
        />
        <MetricCard
          title="Settled"
          value={stateCounts['SETTLED'] || 0}
          icon={CheckCircle}
        />
        <MetricCard
          title="Pending"
          value={(stateCounts['CREATED'] || 0) + (stateCounts['QUOTED'] || 0) + (stateCounts['AWAITING_PAYMENT'] || 0)}
          icon={Clock}
        />
      </div>

      {/* API Key Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">API Key</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border rounded-lg px-3 py-2 text-sm font-mono break-all">
                {apiKey || 'Not available — re-login to view'}
              </code>
              <button
                onClick={copyApiKey}
                className="p-2 border rounded-lg hover:bg-gray-50 shrink-0"
                title="Copy"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={regenerateKey}
                disabled={regenerating}
                className="p-2 border rounded-lg hover:bg-gray-50 shrink-0"
                title="Regenerate"
              >
                <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 mt-1">Copied!</p>}
          </div>

          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-1">How to use:</p>
            <code className="block bg-gray-50 border rounded-lg p-3 text-xs">
{`curl -X POST http://localhost:3002/api/v1/intents \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token?.slice(0, 30)}..." \\
  -d '{"order_ref":"ORDER-001","target_amount":100,"target_asset":"USDC","target_chain":"8453","accepted_assets":["ETH","USDC","USDT"]}'`}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Settlement Config */}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>Settlement Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <span className="text-sm text-muted-foreground">Asset</span>
                <p className="font-medium">{profile.settlement_asset}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Chain</span>
                <p className="font-medium">{profile.settlement_chain}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Fee</span>
                <p className="font-medium">{profile.fee_percentage}%</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">KYC Threshold</span>
                <p className="font-medium">${Number(profile.kyc_threshold).toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Wallet Address</span>
              <p className="font-mono text-sm break-all">{profile.settlement_address}</p>
            </div>
            {profile.webhook_url && (
              <div className="mt-3">
                <span className="text-sm text-muted-foreground">Webhook URL</span>
                <p className="text-sm flex items-center gap-1">
                  {profile.webhook_url}
                  <ExternalLink className="h-3 w-3" />
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Intents */}
      <Card>
        <CardHeader>
          <CardTitle>Your Payment Intents</CardTitle>
        </CardHeader>
        <CardContent>
          {intents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No payment intents yet.</p>
              <p className="text-sm mt-1">Create one via the API to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-3 text-left font-medium text-muted-foreground">Order</th>
                    <th className="pb-3 text-left font-medium text-muted-foreground">Amount</th>
                    <th className="pb-3 text-left font-medium text-muted-foreground">Asset</th>
                    <th className="pb-3 text-left font-medium text-muted-foreground">State</th>
                    <th className="pb-3 text-right font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {intents.map((intent) => (
                    <tr
                      key={intent.intent_id}
                      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      void navigator.clipboard.writeText(intent.intent_id);
                    }}
                    >
                      <td className="py-3 font-medium">{intent.order_ref}</td>
                      <td className="py-3">{intent.target_amount.toLocaleString()}</td>
                      <td className="py-3">{intent.target_asset}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStateBadge(intent.state)}`}>
                          {intent.state.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {new Date(intent.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

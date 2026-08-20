'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CHAINS = [
  { id: '1', name: 'Ethereum' },
  { id: '8453', name: 'Base' },
  { id: '42161', name: 'Arbitrum' },
  { id: '137', name: 'Polygon' },
];

const ASSETS = ['USDC', 'USDT', 'ETH', 'DAI', 'WBTC'];

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ apiKey: string; token: string; merchantId: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    settlement_asset: 'USDC',
    settlement_chain: '8453',
    settlement_address: '',
    webhook_url: '',
    accepted_chains: ['1', '8453'],
    accepted_assets: ['USDC', 'USDT', 'ETH'],
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authApi.register(form);
      setSuccess({
        apiKey: result.data.api_key || '',
        token: result.data.token,
        merchantId: result.data.merchant_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleChain = (chainId: string) => {
    setForm((prev) => ({
      ...prev,
      accepted_chains: prev.accepted_chains.includes(chainId)
        ? prev.accepted_chains.filter((c) => c !== chainId)
        : [...prev.accepted_chains, chainId],
    }));
  };

  const toggleAsset = (asset: string) => {
    setForm((prev) => ({
      ...prev,
      accepted_assets: prev.accepted_assets.includes(asset)
        ? prev.accepted_assets.filter((a) => a !== asset)
        : [...prev.accepted_assets, asset],
    }));
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-2xl text-emerald-600">✅ Registration Successful!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Save your API key securely — it will not be shown again.
            </p>
            <div className="rounded-lg border bg-gray-50 p-4 space-y-2">
              <div>
                <span className="text-sm font-medium text-muted-foreground">Merchant ID:</span>
                <p className="font-mono text-sm break-all">{success.merchantId}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground">API Key:</span>
                <p className="font-mono text-sm break-all bg-white p-2 rounded border">{success.apiKey}</p>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem('cg_token', success.token);
                localStorage.setItem('cg_api_key', success.apiKey);
                localStorage.setItem('cg_merchant_id', success.merchantId);
                router.push('/dashboard');
              }}
              className="w-full bg-primary text-primary-foreground py-2 px-4 rounded-lg font-medium hover:opacity-90"
            >
              Go to Dashboard →
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Create Your Merchant Account</CardTitle>
          <p className="text-muted-foreground">
            Accept crypto payments across multiple chains with one API.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
            )}

            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Account Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Business Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="My Online Store"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="merchant@store.com"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Minimum 8 characters"
                />
              </div>
            </div>

            {/* Settlement */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Settlement Preferences</h3>
              <p className="text-sm text-muted-foreground">
                Where do you want to receive your money?
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Settlement Asset</label>
                  <select
                    value={form.settlement_asset}
                    onChange={(e) => setForm({ ...form, settlement_asset: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {ASSETS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Settlement Chain</label>
                  <select
                    value={form.settlement_chain}
                    onChange={(e) => setForm({ ...form, settlement_chain: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {CHAINS.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Your Wallet Address *</label>
                <input
                  type="text"
                  required
                  value={form.settlement_address}
                  onChange={(e) => setForm({ ...form, settlement_address: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="0x..."
                />
              </div>
            </div>

            {/* Accepted Payments */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Accept Payments From</h3>
              <div>
                <label className="block text-sm font-medium mb-2">Chains</label>
                <div className="flex flex-wrap gap-2">
                  {CHAINS.map((chain) => (
                    <button
                      key={chain.id}
                      type="button"
                      onClick={() => toggleChain(chain.id)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        form.accepted_chains.includes(chain.id)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-white text-muted-foreground border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {chain.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Assets</label>
                <div className="flex flex-wrap gap-2">
                  {ASSETS.map((asset) => (
                    <button
                      key={asset}
                      type="button"
                      onClick={() => toggleAsset(asset)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        form.accepted_assets.includes(asset)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-white text-muted-foreground border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {asset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Webhook */}
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Webhook URL</h3>
              <p className="text-sm text-muted-foreground">
                We&apos;ll notify you here when payments are settled.
              </p>
              <input
                type="url"
                value={form.webhook_url}
                onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="https://yourapp.com/api/crypto-webhook"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Create Merchant Account →'}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <a href="/login" className="text-primary font-medium hover:underline">
                Sign in
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

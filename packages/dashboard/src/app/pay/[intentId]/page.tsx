'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { IntentDetail } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const STATE_MESSAGES: Record<string, { label: string; color: string; icon: string }> = {
  CREATED: { label: 'Preparing...', color: 'text-blue-600', icon: '⏳' },
  QUOTED: { label: 'Awaiting Payment', color: 'text-amber-600', icon: '💰' },
  AWAITING_PAYMENT: { label: 'Awaiting Payment', color: 'text-amber-600', icon: '💰' },
  DETECTED: { label: 'Payment Detected', color: 'text-cyan-600', icon: '🔍' },
  CONFIRMING: { label: 'Confirming on-chain', color: 'text-blue-600', icon: '⛓️' },
  ROUTING: { label: 'Routing funds', color: 'text-indigo-600', icon: '🛣️' },
  SETTLING: { label: 'Settling payment', color: 'text-orange-600', icon: '💸' },
  SETTLED: { label: 'Payment Complete!', color: 'text-emerald-600', icon: '✅' },
  FAILED: { label: 'Payment Failed', color: 'text-red-600', icon: '❌' },
};

export default function PayPage() {
  const params = useParams();
  const intentId = params.intentId as string;
  const [intent, setIntent] = useState<IntentDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const fetchIntent = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/intents/${intentId}`);
      if (!res.ok) {
        throw new Error('Payment not found');
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument
      const data = await res.json();
      setIntent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment');
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    void fetchIntent();
    const interval = setInterval(() => { void fetchIntent(); }, 5000);
    return () => clearInterval(interval);
  }, [fetchIntent]);

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-muted-foreground">Loading payment...</div>
      </div>
    );
  }

  if (error || !intent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-2xl mb-2">😔</p>
          <p className="text-lg font-medium">Payment Not Found</p>
          <p className="text-muted-foreground mt-1">{error || 'This payment link is invalid.'}</p>
        </div>
      </div>
    );
  }

  const stateInfo = STATE_MESSAGES[intent.state] || { label: intent.state, color: 'text-gray-600', icon: '❓' };
  const quote = intent.events.find((e) => e.event_type === 'QUOTE_GENERATED')?.payload as Record<string, unknown> | undefined;
  const depositAddress = quote?.deposit_address as string | undefined;
  const depositAsset = quote?.deposit_asset as string | undefined;
  const depositChain = quote?.deposit_chain as string | undefined; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
  const rate = intent.quoted_rate;

  const expectedCrypto = rate ? (intent.target_amount / rate).toFixed(6) : null;

  const progressSteps = ['CREATED', 'QUOTED', 'AWAITING_PAYMENT', 'DETECTED', 'CONFIRMING', 'ROUTING', 'SETTLING', 'SETTLED'];
  const currentStepIndex = progressSteps.indexOf(intent.state);
  const isTerminal = intent.state === 'SETTLED' || intent.state === 'FAILED';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold">{intent.order_ref}</h1>
          <p className="text-muted-foreground mt-1">
            {intent.target_amount.toLocaleString()} {intent.target_asset}
          </p>
        </div>

        {/* Status */}
        <div className={`text-center text-lg font-semibold ${stateInfo.color}`}>
          <span className="text-2xl mr-2">{stateInfo.icon}</span>
          {stateInfo.label}
        </div>

        {/* Progress Bar */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex justify-between mb-2">
            {progressSteps.map((step, i) => (
              <div
                key={step}
                className={`h-2 flex-1 mx-0.5 rounded-full transition-colors ${
                  i <= currentStepIndex
                    ? isTerminal && intent.state === 'FAILED'
                      ? 'bg-red-400'
                      : 'bg-emerald-400'
                    : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Created</span>
            <span>Settled</span>
          </div>
        </div>

        {/* Payment Details (shown when QUOTED or AWAITING_PAYMENT) */}
        {depositAddress && (intent.state === 'QUOTED' || intent.state === 'AWAITING_PAYMENT') && (
          <div className="bg-white rounded-xl border p-6 space-y-5">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Send exactly</p>
              <p className="text-3xl font-bold">{expectedCrypto} {depositAsset}</p>
              {rate && (
                <p className="text-sm text-muted-foreground mt-1">
                  Rate: 1 {depositAsset} = ${rate.toLocaleString()} {intent.target_asset}
                </p>
              )}
            </div>

            {/* QR Code placeholder */}
            <div className="flex justify-center">
              <div className="w-48 h-48 bg-gray-100 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-300">
                <div className="text-center text-muted-foreground">
                  <p className="text-4xl mb-2">📱</p>
                  <p className="text-xs">Scan QR Code</p>
                  <p className="text-xs">(via wallet app)</p>
                </div>
              </div>
            </div>

            {/* Deposit Address */}
            <div>
              <p className="text-sm text-muted-foreground mb-1">Deposit Address ({depositChain})</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 border rounded-lg px-3 py-2 text-xs font-mono break-all">
                  {depositAddress}
                </code>
                <button
                  onClick={() => copyAddress(depositAddress)}
                  className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 shrink-0"
                >
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Expiry */}
            {intent.quote_expires_at && (
              <div className="text-center text-sm text-muted-foreground">
                ⏰ Quote expires at {new Date(intent.quote_expires_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* Settled */}
        {intent.state === 'SETTLED' && (
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-6 text-center">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-lg font-semibold text-emerald-800">Payment Received!</p>
            <p className="text-sm text-emerald-700 mt-1">
              {intent.target_amount.toLocaleString()} {intent.target_asset} has been settled.
            </p>
          </div>
        )}

        {/* Failed */}
        {intent.state === 'FAILED' && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-6 text-center">
            <p className="text-4xl mb-3">❌</p>
            <p className="text-lg font-semibold text-red-800">Payment Failed</p>
            <p className="text-sm text-red-700 mt-1">
              Something went wrong. Please try again or contact support.
            </p>
          </div>
        )}

        {/* Transaction History */}
        {intent.events.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Transaction History</h3>
            <div className="space-y-2">
              {intent.events.map((event, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <div>
                    <p className="font-medium">{event.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Powered By */}
        <p className="text-center text-xs text-muted-foreground">
          Powered by Crypto Gateway
        </p>
      </div>
    </div>
  );
}

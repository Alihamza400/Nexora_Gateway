'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';

const CRYPTO_OPTIONS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '🔷', chains: ['Ethereum', 'Base', 'Arbitrum'] },
  { symbol: 'USDC', name: 'USD Coin', icon: '🔵', chains: ['Ethereum', 'Base', 'Arbitrum', 'Polygon'] },
  { symbol: 'USDT', name: 'Tether', icon: '🟢', chains: ['Ethereum', 'Tron', 'Polygon'] },
];

const MOCK_ADDRESSES: Record<string, string> = {
  ETH: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  USDC: '0x28C6c06298d514Db089934071355E5743bf21d60',
  USDT: '0x8894E0a0c962CB723c1ef8a1B676f13F84c0518b',
};

const MOCK_RATES: Record<string, number> = {
  ETH: 3500,
  USDC: 1,
  USDT: 1,
};

type DemoState = 'select' | 'quote' | 'waiting' | 'detected' | 'confirming' | 'settled';

export default function PayDemoPage() {
  const [step, setStep] = useState<DemoState>('select');
  const [selectedCrypto, setSelectedCrypto] = useState<string>('');
  const [selectedChain, setSelectedChain] = useState<string>('');
  const [amount] = useState(250);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const crypto = CRYPTO_OPTIONS.find((c) => c.symbol === selectedCrypto);
  const rate = MOCK_RATES[selectedCrypto] || 1;
  const cryptoAmount = selectedCrypto === 'ETH' ? (amount / rate).toFixed(6) : amount.toFixed(2);
  const depositAddress = MOCK_ADDRESSES[selectedCrypto] || '0x0000000000000000000000000000000000000000';

  // Auto-progress through states
  useEffect(() => {
    if (step === 'select' || step === 'quote') return;

    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step === 'waiting' && elapsed >= 8) {
      setStep('detected');
      setElapsed(0);
    } else if (step === 'detected' && elapsed >= 5) {
      setStep('confirming');
      setElapsed(0);
    } else if (step === 'confirming' && elapsed >= 6) {
      setStep('settled');
      setElapsed(0);
    }
  }, [step, elapsed]);

  const handleSelectCrypto = (symbol: string) => {
    setSelectedCrypto(symbol);
    const chains = CRYPTO_OPTIONS.find((c) => c.symbol === symbol)?.chains || [];
    setSelectedChain(chains[0] || '');
  };

  const handleGetQuote = () => {
    setStep('quote');
    setTimeout(() => setStep('waiting'), 1500);
    setElapsed(0);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setStep('select');
    setSelectedCrypto('');
    setSelectedChain('');
    setElapsed(0);
  };

  const progressSteps = ['Waiting', 'Detected', 'Confirming', 'Settled'];
  const currentStepIndex = step === 'waiting' ? 0 : step === 'detected' ? 1 : step === 'confirming' ? 2 : step === 'settled' ? 3 : -1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-8 w-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">CG</div>
            <span className="text-white font-semibold text-lg">Crypto Gateway</span>
          </div>
          <p className="text-slate-400 text-sm">Pay for Order #ORD-2024-001</p>
          <p className="text-white text-2xl font-bold mt-2">${amount.toFixed(2)} USD</p>
        </div>

        {/* Step 1: Select Crypto */}
        {step === 'select' && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-white font-semibold">Select Payment Method</h3>

              <div className="space-y-2">
                {CRYPTO_OPTIONS.map((opt) => (
                  <button
                    key={opt.symbol}
                    onClick={() => handleSelectCrypto(opt.symbol)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      selectedCrypto === opt.symbol
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                    }`}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <div className="text-left flex-1">
                      <p className="text-white font-medium">{opt.symbol}</p>
                      <p className="text-slate-400 text-xs">{opt.name}</p>
                    </div>
                    <span className="text-slate-400 text-sm">
                      ≈ {selectedCrypto === opt.symbol ? cryptoAmount : (amount / (MOCK_RATES[opt.symbol] || 1)).toFixed(opt.symbol === 'ETH' ? 6 : 2)} {opt.symbol}
                    </span>
                  </button>
                ))}
              </div>

              {selectedCrypto && (
                <div className="space-y-2 pt-2">
                  <label className="text-slate-400 text-sm">Network</label>
                  <div className="flex flex-wrap gap-2">
                    {crypto?.chains.map((chain) => (
                      <button
                        key={chain}
                        onClick={() => setSelectedChain(chain)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          selectedChain === chain
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-slate-700 text-slate-300 border-slate-600 hover:border-slate-500'
                        }`}
                      >
                        {chain}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleGetQuote}
                disabled={!selectedCrypto || !selectedChain}
                className="w-full bg-emerald-500 text-white py-3 rounded-xl font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-4"
              >
                Continue with {selectedCrypto || '...'}
              </button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Generating Quote */}
        {step === 'quote' && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-8 text-center">
              <div className="animate-spin h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-white font-medium">Generating quote...</p>
              <p className="text-slate-400 text-sm mt-1">Locking exchange rate</p>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Waiting for Payment */}
        {(step === 'waiting' || step === 'detected' || step === 'confirming') && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-6 space-y-5">
              {/* Status */}
              <div className="text-center">
                {step === 'waiting' && (
                  <>
                    <div className="text-4xl mb-2">💰</div>
                    <p className="text-amber-400 font-semibold">Awaiting Payment</p>
                    <p className="text-slate-400 text-sm">Send exactly the amount below</p>
                  </>
                )}
                {step === 'detected' && (
                  <>
                    <div className="text-4xl mb-2">🔍</div>
                    <p className="text-cyan-400 font-semibold">Payment Detected!</p>
                    <p className="text-slate-400 text-sm">Waiting for block confirmations...</p>
                  </>
                )}
                {step === 'confirming' && (
                  <>
                    <div className="text-4xl mb-2">⛓️</div>
                    <p className="text-blue-400 font-semibold">Confirming on-chain</p>
                    <p className="text-slate-400 text-sm">Processing your transaction...</p>
                  </>
                )}
              </div>

              {/* Amount */}
              <div className="bg-slate-700/50 rounded-xl p-4 text-center">
                <p className="text-slate-400 text-sm mb-1">Send exactly</p>
                <p className="text-white text-3xl font-bold">
                  {cryptoAmount} {selectedCrypto}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  ≈ ${amount.toFixed(2)} USD
                </p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="w-44 h-44 bg-white rounded-xl flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-40 h-40 bg-slate-100 rounded-lg flex items-center justify-center">
                      {/* Simple QR pattern */}
                      <svg viewBox="0 0 100 100" className="w-32 h-32">
                        <rect x="5" y="5" width="25" height="25" fill="black" />
                        <rect x="8" y="8" width="19" height="19" fill="white" />
                        <rect x="11" y="11" width="13" height="13" fill="black" />
                        <rect x="70" y="5" width="25" height="25" fill="black" />
                        <rect x="73" y="8" width="19" height="19" fill="white" />
                        <rect x="76" y="11" width="13" height="13" fill="black" />
                        <rect x="5" y="70" width="25" height="25" fill="black" />
                        <rect x="8" y="73" width="19" height="19" fill="white" />
                        <rect x="11" y="76" width="13" height="13" fill="black" />
                        <rect x="35" y="5" width="5" height="5" fill="black" />
                        <rect x="45" y="5" width="5" height="5" fill="black" />
                        <rect x="55" y="5" width="5" height="5" fill="black" />
                        <rect x="35" y="15" width="5" height="5" fill="black" />
                        <rect x="50" y="15" width="5" height="5" fill="black" />
                        <rect x="60" y="15" width="5" height="5" fill="black" />
                        <rect x="35" y="35" width="30" height="30" fill="black" />
                        <rect x="38" y="38" width="24" height="24" fill="white" />
                        <rect x="41" y="41" width="18" height="18" fill="black" />
                        <rect x="5" y="40" width="5" height="5" fill="black" />
                        <rect x="15" y="40" width="5" height="5" fill="black" />
                        <rect x="25" y="40" width="5" height="5" fill="black" />
                        <rect x="70" y="40" width="5" height="5" fill="black" />
                        <rect x="80" y="40" width="5" height="5" fill="black" />
                        <rect x="90" y="40" width="5" height="5" fill="black" />
                        <rect x="40" y="70" width="5" height="5" fill="black" />
                        <rect x="50" y="75" width="5" height="5" fill="black" />
                        <rect x="60" y="80" width="5" height="5" fill="black" />
                        <rect x="70" y="70" width="5" height="5" fill="black" />
                        <rect x="80" y="75" width="5" height="5" fill="black" />
                        <rect x="90" y="80" width="5" height="5" fill="black" />
                        <rect x="75" y="85" width="5" height="5" fill="black" />
                        <rect x="85" y="90" width="5" height="5" fill="black" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deposit Address */}
              <div>
                <p className="text-slate-400 text-sm mb-1">Deposit Address ({selectedChain})</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 break-all">
                    {depositAddress}
                  </code>
                  <button
                    onClick={copyAddress}
                    className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white hover:bg-slate-600 shrink-0 transition-colors"
                  >
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex gap-1">
                  {progressSteps.map((s, i) => (
                    <div
                      key={s}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                        i <= currentStepIndex ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Detected</span>
                  <span>Confirmed</span>
                  <span>Settled</span>
                </div>
              </div>

              {/* Timer */}
              <div className="text-center text-slate-400 text-sm">
                ⏱️ {elapsed}s elapsed
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Settled! */}
        {step === 'settled' && (
          <Card className="bg-slate-800 border-emerald-500/50">
            <CardContent className="p-8 text-center space-y-4">
              <div className="text-6xl mb-2">🎉</div>
              <p className="text-emerald-400 text-2xl font-bold">Payment Complete!</p>
              <p className="text-slate-300">
                {cryptoAmount} {selectedCrypto} received
              </p>
              <p className="text-slate-400 text-sm">
                Order #ORD-2024-001 has been paid
              </p>

              <div className="bg-slate-700/50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Amount</span>
                  <span className="text-white font-medium">{cryptoAmount} {selectedCrypto}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Network</span>
                  <span className="text-white">{selectedChain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className="text-emerald-400 font-medium">✓ Settled</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tx Hash</span>
                  <span className="text-white font-mono text-xs">0x7f9fade...b3c4</span>
                </div>
              </div>

              <button
                onClick={reset}
                className="w-full bg-slate-700 text-white py-3 rounded-xl font-medium hover:bg-slate-600 transition-colors"
              >
                Try Another Payment
              </button>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-slate-500 text-xs">
          Powered by Crypto Gateway • This is a demo
        </p>
      </div>
    </div>
  );
}

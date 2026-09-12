import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';
import { ConfigurationError } from './errors.js';

describe('loadConfig', () => {
  it('fails fast when no chain RPC endpoint is configured', () => {
    // A worker with no chains would start, report ready, and watch nothing.
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(() => loadConfig({})).toThrow(/No chain RPC endpoints configured/);
  });

  it('enables only the chains whose RPC endpoint is present', () => {
    const config = loadConfig({ BASE_RPC_URL: 'https://sepolia.base.org' });

    expect(config.chains).toHaveLength(1);
    expect(config.chains[0]?.chainId).toBe('84532');
    expect(config.chains[0]?.family).toBe('evm');
  });

  it('classifies each chain family so the right client is constructed', () => {
    const config = loadConfig({
      BASE_RPC_URL: 'https://sepolia.base.org',
      TRON_FULL_NODE: 'https://nile.trongrid.io',
      SOLANA_RPC_URL: 'https://api.devnet.solana.com',
    });

    const families = config.chains.map((c) => `${c.chainId}:${c.family}`).sort();
    expect(families).toEqual(['84532:evm', 'solana-devnet:solana', 'tron-nile:tron']);
  });

  it('honours a confirmation depth override', () => {
    const config = loadConfig({
      BASE_RPC_URL: 'https://sepolia.base.org',
      BASE_CONFIRMATION_DEPTH: '30',
    });

    expect(config.chains[0]?.confirmationDepth).toBe(30);
  });

  it('rejects a malformed confirmation depth instead of coercing it', () => {
    expect(() =>
      loadConfig({ BASE_RPC_URL: 'https://sepolia.base.org', BASE_CONFIRMATION_DEPTH: 'twelve' }),
    ).toThrow(/BASE_CONFIRMATION_DEPTH must be an integer/);
  });

  it('rejects a confirmation depth below 1', () => {
    expect(() =>
      loadConfig({ BASE_RPC_URL: 'https://sepolia.base.org', BASE_CONFIRMATION_DEPTH: '0' }),
    ).toThrow(/BASE_CONFIRMATION_DEPTH must be an integer >= 1/);
  });

  it('applies operational defaults', () => {
    const config = loadConfig({ BASE_RPC_URL: 'https://sepolia.base.org' });

    expect(config.port).toBe(3000);
    expect(config.concurrency).toBe(4);
    expect(config.jobMaxAttempts).toBe(5);
    expect(config.visibilityTimeoutMs).toBe(120000);
  });

  it('generates a unique worker id per process when none is supplied', () => {
    const a = loadConfig({ BASE_RPC_URL: 'https://x' });
    const b = loadConfig({ BASE_RPC_URL: 'https://x' });

    expect(a.workerId).toMatch(/^worker-/);
    // Distinct ids matter: they are what makes a stuck job attributable to a process.
    expect(a.workerId).not.toBe(b.workerId);
  });

  it('accepts an explicit worker id', () => {
    const config = loadConfig({ BASE_RPC_URL: 'https://x', WORKER_ID: 'worker-7' });
    expect(config.workerId).toBe('worker-7');
  });
});

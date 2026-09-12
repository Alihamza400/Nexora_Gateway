import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, redact } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Read the first argument of the first call without touching `any`-typed mocks. */
function firstLine(spy: { mock: { calls: unknown[][] } }): string {
  const call = spy.mock.calls[0];
  const value = call ? call[0] : undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

describe('redact', () => {
  it('removes credential-bearing fields whatever their case', () => {
    const result = redact({
      apiKey: 'sk_live_abc',
      API_KEY: 'sk_live_def',
      password: 'hunter2',
      authorization: 'Bearer token',
      webhook_secret: 'whsec_1',
    }) as Record<string, unknown>;

    expect(result['apiKey']).toBe('[redacted]');
    expect(result['API_KEY']).toBe('[redacted]');
    expect(result['password']).toBe('[redacted]');
    expect(result['authorization']).toBe('[redacted]');
    expect(result['webhook_secret']).toBe('[redacted]');
  });

  it('redacts credentials nested inside objects and arrays', () => {
    const result = redact({
      merchant: { id: 'm-1', config: { privateKey: '0xabc', token: 't' } },
      providers: [{ secret: 's' }, { name: 'lifi' }],
    }) as {
      merchant: { id: string; config: Record<string, unknown> };
      providers: Record<string, unknown>[];
    };

    expect(result.merchant.id).toBe('m-1');
    expect(result.merchant.config['privateKey']).toBe('[redacted]');
    expect(result.merchant.config['token']).toBe('[redacted]');
    expect(result.providers[0]?.['secret']).toBe('[redacted]');
    expect(result.providers[1]?.['name']).toBe('lifi');
  });

  it('redacts a private key even when the field name gives nothing away', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
    expect(redact({ note: pem })).toEqual({ note: '[redacted]' });
  });

  it('leaves ordinary values untouched', () => {
    expect(redact({ intentId: 'i-1', amount: 100, ok: true, none: null })).toEqual({
      intentId: 'i-1',
      amount: 100,
      ok: true,
      none: null,
    });
  });

  it('bounds recursion so a pathological object cannot hang the worker', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain('[depth-limit]');
  });
});

describe('createLogger', () => {
  it('drops entries below the configured level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger('warn');

    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown');

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('redacts fields before writing them', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger('info');

    logger.info('screening call', { address: '0x1', apiKey: 'sk_live_secret' });

    const written = log.mock.calls.map((call) => JSON.stringify(call[0])).join('\n');
    expect(written).toContain('screening call');
    expect(written).not.toContain('sk_live_secret');
    expect(written).toContain('[redacted]');
  });

  it('writes structured JSON by default and pretty output on request', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger('info').info('json-mode');
    expect(() => JSON.parse(firstLine(log)) as unknown).not.toThrow();

    log.mockClear();
    createLogger('info', true).info('pretty-mode');
    expect(firstLine(log)).toContain('INFO');
  });

  it('routes error and warn to the matching console channel', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger('debug');

    logger.error('boom');
    logger.warn('careful');

    expect(error).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});
